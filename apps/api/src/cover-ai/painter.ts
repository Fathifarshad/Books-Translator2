import type {
  CloudflareImageModel,
  PainterEngine,
  PainterTestResult,
  PainterUpdate,
  PainterView,
} from '@dozabaneh/shared';
import type { Db } from '../db/client';
import type { SecretBox } from '../settings/secrets';
import { getSetting, setSetting } from '../settings/store';

/**
 * The cover's illustrator (ADR-048, stage 2): draws a picture from an English description, never lettering. Two
 * engines, both free to the owner: Cloudflare Workers AI (FLUX, inside the free daily allowance; the account id and
 * an API token are stored here, the token encrypted) and a model on this computer through ComfyUI's HTTP API. The
 * chosen engine draws; when it fails, the other one (if set up) is tried.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface Stored {
  engine: PainterEngine;
  cloudflare: { accountId: string | null; token: string | null; model: CloudflareImageModel };
  comfy: { url: string; checkpoint: string };
}

const KEY = 'cover:painter';
const DEFAULTS: Stored = {
  engine: 'none',
  cloudflare: { accountId: null, token: null, model: 'flux-2-klein-4b' },
  comfy: { url: 'http://127.0.0.1:8188', checkpoint: '' },
};
const CF = 'https://api.cloudflare.com/client/v4';

export class PainterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Painting {
  data: Buffer;
  mime: string;
  engine: Exclude<PainterEngine, 'none'>;
}

/** JPEG, PNG or WebP by their first bytes. */
export function imageMime(data: Buffer): string | undefined {
  if (data.length < 12) return undefined;
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return undefined;
}

/** Settings ComfyUI needs for a checkpoint: FLUX schnell is distilled (4 steps, no guidance); SDXL is not. */
export function comfyRecipe(checkpoint: string) {
  return /flux/i.test(checkpoint)
    ? { steps: 4, cfg: 1, sampler: 'euler', scheduler: 'simple', width: 768, height: 1088 }
    : { steps: 28, cfg: 6, sampler: 'dpmpp_2m', scheduler: 'karras', width: 832, height: 1216 };
}

/** ComfyUI's text-to-image graph: checkpoint → prompts → empty latent → sampler → decode → save. */
export function comfyWorkflow(checkpoint: string, prompt: string, seed: number): Record<string, unknown> {
  const r = comfyRecipe(checkpoint);
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    '7': {
      class_type: 'CLIPTextEncode',
      inputs: { text: 'text, letters, words, typography, watermark, signature, logo, blurry, lowres', clip: ['4', 1] },
    },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: r.width, height: r.height, batch_size: 1 } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: r.steps,
        cfg: r.cfg,
        sampler_name: r.sampler,
        scheduler: r.scheduler,
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'dozabaneh-cover', images: ['8', 0] } },
  };
}

export class PainterService {
  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private stored(): Stored {
    const s = getSetting<Partial<Stored>>(this.db, KEY) ?? {};
    return {
      engine: s.engine ?? DEFAULTS.engine,
      cloudflare: { ...DEFAULTS.cloudflare, ...(s.cloudflare ?? {}) },
      comfy: { ...DEFAULTS.comfy, ...(s.comfy ?? {}) },
    };
  }

  private token(): string | null {
    const enc = this.stored().cloudflare.token;
    return enc ? this.box.decrypt(enc) : null;
  }

  view(): PainterView {
    const s = this.stored();
    const token = this.token();
    return {
      engine: s.engine,
      cloudflare: {
        accountId: s.cloudflare.accountId,
        hasToken: Boolean(token),
        tokenHint: token ? `…${token.slice(-4)}` : null,
        model: s.cloudflare.model,
      },
      comfy: { url: s.comfy.url, checkpoint: s.comfy.checkpoint },
    };
  }

  update(patch: PainterUpdate): PainterView {
    const s = this.stored();
    if (patch.engine) s.engine = patch.engine;
    if (patch.cloudflareAccountId !== undefined)
      s.cloudflare.accountId = patch.cloudflareAccountId?.toLowerCase() ?? null;
    if (patch.cloudflareToken !== undefined) {
      s.cloudflare.token = patch.cloudflareToken === null ? null : this.box.encrypt(patch.cloudflareToken);
    }
    if (patch.cloudflareModel) s.cloudflare.model = patch.cloudflareModel;
    if (patch.comfyUrl) s.comfy.url = patch.comfyUrl.replace(/\/+$/, '');
    if (patch.comfyCheckpoint !== undefined) s.comfy.checkpoint = patch.comfyCheckpoint;
    setSetting(this.db, KEY, s);
    return this.view();
  }

  /** Engines that can draw now, the chosen one first. */
  ready(): Exclude<PainterEngine, 'none'>[] {
    const s = this.stored();
    if (s.engine === 'none') return [];
    const cf = Boolean(s.cloudflare.accountId && this.token());
    const comfy = Boolean(s.comfy.checkpoint);
    const order: Exclude<PainterEngine, 'none'>[] =
      s.engine === 'comfy' ? ['comfy', 'cloudflare'] : ['cloudflare', 'comfy'];
    return order.filter((e) => (e === 'cloudflare' ? cf : comfy));
  }

  /** Draws one picture; the next ready engine is tried when one fails. */
  async paint(prompt: string, seed = Math.floor(Math.random() * 2 ** 31)): Promise<Painting> {
    const engines = this.ready();
    if (!engines.length) throw new PainterError('NOT_CONFIGURED', 'No illustrator is set up.');
    let last: unknown;
    for (const engine of engines) {
      try {
        const data = engine === 'cloudflare' ? await this.paintCloudflare(prompt) : await this.paintComfy(prompt, seed);
        const mime = imageMime(data);
        if (!mime) throw new PainterError('BAD_RESPONSE', 'The illustrator did not return an image.');
        return { data, mime, engine };
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof PainterError ? last : new PainterError('NETWORK', String((last as Error)?.message ?? last));
  }

  private async paintCloudflare(prompt: string): Promise<Buffer> {
    const { accountId, model } = this.stored().cloudflare;
    const token = this.token();
    if (!accountId || !token) throw new PainterError('NOT_CONFIGURED', 'Cloudflare is not set up.');
    const url = `${CF}/accounts/${accountId}/ai/run/@cf/black-forest-labs/${model}`;
    let body: FormData | string;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (model === 'flux-2-klein-4b') {
      // FLUX.2 takes form fields, even for a prompt alone; portrait, multiples of 16.
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('width', '768');
      form.append('height', '1088');
      body = form;
    } else {
      body = JSON.stringify({ prompt, steps: 8 });
      headers['Content-Type'] = 'application/json';
    }
    const res = await this.call(url, { method: 'POST', headers, body });
    const json = (await res.json().catch(() => null)) as {
      result?: { image?: string };
      errors?: { message?: string }[];
    } | null;
    if (!res.ok || !json?.result?.image) throw cloudflareError(res.status, json?.errors?.[0]?.message);
    return Buffer.from(json.result.image, 'base64');
  }

  private async paintComfy(prompt: string, seed: number): Promise<Buffer> {
    const { url, checkpoint } = this.stored().comfy;
    if (!checkpoint) throw new PainterError('NO_CHECKPOINT', 'No model is chosen for ComfyUI.');
    const queued = await this.call(`${url}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: comfyWorkflow(checkpoint, prompt, seed), client_id: 'dozabaneh' }),
    });
    const { prompt_id: id } = (await queued.json().catch(() => ({}))) as { prompt_id?: string };
    if (!queued.ok || !id) throw new PainterError('BAD_RESPONSE', `ComfyUI refused the request (${queued.status}).`);
    // A local model takes from seconds to a few minutes.
    for (let i = 0; i < 300; i++) {
      await this.wait(1000);
      const h = (await (await this.call(`${url}/history/${id}`)).json().catch(() => ({}))) as Record<
        string,
        {
          outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
          status?: { status_str?: string };
        }
      >;
      const run = h[id];
      if (run?.status?.status_str === 'error')
        throw new PainterError('BAD_RESPONSE', 'ComfyUI could not draw the picture.');
      const image = Object.values(run?.outputs ?? {}).flatMap((o) => o.images ?? [])[0];
      if (image) {
        const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
        const file = await this.call(`${url}/view?${q.toString()}`);
        return Buffer.from(await file.arrayBuffer());
      }
    }
    throw new PainterError('TIMEOUT', 'ComfyUI took too long.');
  }

  private async call(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, init);
    } catch (err) {
      throw new PainterError('NETWORK', (err as Error).message);
    }
  }

  /** Checks an engine without drawing (Cloudflare: the token; ComfyUI: that it answers, and its models). */
  async test(engine: Exclude<PainterEngine, 'none'>): Promise<PainterTestResult> {
    const started = Date.now();
    const done = (r: Omit<PainterTestResult, 'engine' | 'ms'>): PainterTestResult => ({
      ...r,
      engine,
      ms: Date.now() - started,
    });
    try {
      if (engine === 'cloudflare') {
        const { accountId } = this.stored().cloudflare;
        const token = this.token();
        if (!accountId || !token) return done({ ok: false, error: 'NOT_CONFIGURED' });
        const auth = { headers: { Authorization: `Bearer ${token}` } };
        // A user token and an account token are verified at different addresses.
        for (const url of [`${CF}/user/tokens/verify`, `${CF}/accounts/${accountId}/tokens/verify`]) {
          const res = await this.call(url, auth);
          const json = (await res.json().catch(() => null)) as {
            success?: boolean;
            result?: { status?: string };
          } | null;
          if (res.ok && json?.success && json.result?.status === 'active') return done({ ok: true });
        }
        return done({ ok: false, error: 'AUTH' });
      }
      const { url } = this.stored().comfy;
      const res = await this.call(`${url}/object_info/CheckpointLoaderSimple`);
      if (!res.ok) return done({ ok: false, error: 'BAD_RESPONSE' });
      const info = (await res.json().catch(() => ({}))) as {
        CheckpointLoaderSimple?: { input?: { required?: { ckpt_name?: [string[]] } } };
      };
      const checkpoints = info.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
      return done({
        ok: checkpoints.length > 0,
        checkpoints,
        ...(checkpoints.length ? {} : { error: 'NO_CHECKPOINT' }),
      });
    } catch (err) {
      return done({
        ok: false,
        error: err instanceof PainterError ? err.code : 'NETWORK',
        message: (err as Error).message,
      });
    }
  }
}

function cloudflareError(status: number, message = ''): PainterError {
  if (status === 401 || status === 403) return new PainterError('AUTH', message || 'Cloudflare rejected the token.');
  if (status === 429 || /neurons|allocation|quota|limit/i.test(message)) {
    return new PainterError('QUOTA', message || 'The free daily allowance is used up.');
  }
  return new PainterError('BAD_RESPONSE', message || `Cloudflare answered ${status}.`);
}

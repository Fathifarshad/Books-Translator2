import { getLanguage } from '@dozabaneh/text';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';

/**
 * «بخوان» (SPEC §13.9, the `browser` voice source): reads the section on screen with the voice the computer or
 * phone already has. Free and needs nothing installed — but it speaks, it does not write a file, so a recording
 * to keep or to put on a phone comes from one of the other sources in Settings.
 *
 * The text is taken from the target column as rendered, so what is read is exactly what is on screen.
 */
function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const tag = lang.toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith(tag)) ??
    voices.find((v) => v.lang.toLowerCase().replace('_', '-').split('-')[0] === tag)
  );
}

function sectionText(): string {
  const cells = document.querySelectorAll('[data-col="target"] p');
  return [...cells]
    .map((cell) => cell.textContent?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

export function ReadAloud({ lang }: { lang: string }) {
  const { t } = useTranslation();
  const [speaking, setSpeaking] = useState(false);
  const [missing, setMissing] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Stop when the reader leaves the page; a voice that keeps talking over the next section is worse than none.
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  if (!supported) return null;

  const stop = () => {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const start = () => {
    const text = sectionText();
    if (!text) return;
    const voice = voiceFor(lang);
    if (!voice) {
      setMissing(true);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setMissing(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <>
      <Button
        icon={speaking ? 'close' : 'sparkle'}
        aria-pressed={speaking}
        onClick={() => (speaking ? stop() : start())}
        data-testid="read-aloud"
      >
        {speaking ? t('reader.stopSpeaking') : t('reader.speak')}
      </Button>
      {missing ? (
        <span role="alert" className="text-xs text-danger" dir={getLanguage(lang).dir}>
          {t('reader.speakUnavailable')}
        </span>
      ) : null}
    </>
  );
}

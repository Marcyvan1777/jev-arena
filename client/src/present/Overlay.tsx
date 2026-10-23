import { useEffect, useState } from 'react';
import './present.css';

export interface Card { kicker?: string; title: string; lines?: string[]; foot?: string; tone?: 'lime' | 'red' | 'blue' | 'gold' }
interface Voice {
  caption(text: string): void; captionOff(): void; chapter(text: string): void; card(card: Card): void; cardOff(): void; clear(): void;
}
declare global { interface Window { __vo?: Voice } }

/**
 * Titles and subtitles for a recording. A script (or the browser console) drives it through window.__vo:
 *   __vo.card({ kicker, title, lines, foot }), __vo.caption('text'), __vo.chapter('1 / THE USE CASE'), __vo.clear()
 */
export function Overlay() {
  const [caption, setCaption] = useState<{ text: string; key: number } | null>(null), [chapter, setChapter] = useState(''), [card, setCard] = useState<Card | null>(null), [cardKey, setCardKey] = useState(0);
  useEffect(() => {
    let key = 0;
    window.__vo = {
      caption: text => setCaption({ text, key: ++key }), captionOff: () => setCaption(null), chapter: setChapter,
      card: next => { setCard(next); setCardKey(k => k + 1); }, cardOff: () => setCard(null),
      clear: () => { setCaption(null); setCard(null); setChapter(''); },
    };
    return () => { delete window.__vo; };
  }, []);
  return <div className="vo" aria-hidden="true">
    {chapter && <div className="vo-chapter" key={chapter}>{chapter}</div>}
    {caption && <div className="vo-caption" key={caption.key}><span>{caption.text}</span></div>}
    {card && <div className={'vo-card ' + (card.tone ?? 'lime')} key={cardKey}>
      <div className="vo-card-inner">
        {card.kicker && <div className="vo-kicker">{card.kicker}</div>}
        <h1>{card.title}</h1>
        {card.lines?.map((line, i) => <p key={i} style={{ animationDelay: 0.5 + i * 0.55 + 's' }}>{line}</p>)}
        {card.foot && <div className="vo-foot">{card.foot}</div>}
      </div>
    </div>}
  </div>;
}

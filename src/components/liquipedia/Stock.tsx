import { stockUrl } from "../../lib/liquipedia/chars";

/** Inline stock-counter sprite for a character name; renders nothing if unknown. */
export function Stock({ char, size = 18 }: { char: string; size?: number }) {
  const url = stockUrl(char);
  if (!url) return null;
  return <img className="lq-stock" src={url} alt={char} title={char} width={size} height={size} />;
}

/** Row of stock icons for a player's mains (primary first). */
export function Mains({ chars, size = 16 }: { chars: string[]; size?: number }) {
  if (chars.length === 0) return null;
  return (
    <span className="lq-mains">
      {chars.map((c) => (
        <Stock key={c} char={c} size={size} />
      ))}
    </span>
  );
}

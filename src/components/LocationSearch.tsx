// src/components/LocationSearch.tsx
// A Google-Maps-style place field: type to search (debounced, abortable), pick from
// a results dropdown, or use GPS. Self-contained — geocoding lives in api/geocode.
// Results render in normal flow (no absolute overlay) so the panel never clips them.

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, KeyboardEvent } from "react";
import { searchPlaces, type Place } from "../api/geocode";
import { COLORS, RADIUS, FONT, glass } from "./ui";
import { Icon } from "./Icon";

interface Props {
  kind: "start" | "end";
  placeholder: string;
  /** Externally selected label (map tap / GPS / swap) shown when not editing. */
  value: string | null;
  onPick: (wp: { lat: number; lon: number; label: string }) => void;
  onClear: () => void;
  onGps?: () => void;
  gpsLoading?: boolean;
  autoFocus?: boolean;
}

const DEBOUNCE_MS = 240;

export default function LocationSearch({
  kind, placeholder, value, onPick, onClear, onGps, gpsLoading, autoFocus,
}: Props) {
  const [text, setText] = useState(value ?? "");
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number>(0);
  const abort = useRef<AbortController | null>(null);
  const editing = useRef(false); // user is typing → don't let external value clobber

  // Reflect an externally-set value when the user isn't mid-edit.
  useEffect(() => {
    if (!editing.current) setText(value ?? "");
  }, [value]);

  useEffect(() => () => abort.current?.abort(), []);

  const search = (q: string) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setLoading(true);
    setError(false);
    searchPlaces(q, ctrl.signal)
      .then((places) => { setResults(places); setActive(-1); setLoading(false); })
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError") return;
        setError(true); setResults([]); setLoading(false);
      });
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    editing.current = true;
    setText(v);
    setOpen(true);
    window.clearTimeout(timer.current);
    if (v.trim().length < 2) { abort.current?.abort(); setResults([]); setLoading(false); return; }
    timer.current = window.setTimeout(() => search(v), DEBOUNCE_MS);
  };

  const pick = (p: Place) => {
    editing.current = false;
    const label = p.secondary ? `${p.primary}, ${p.secondary}` : p.primary;
    setText(label);
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
    onPick({ lat: p.lat, lon: p.lon, label });
  };

  const clear = () => {
    editing.current = false;
    setText("");
    setResults([]);
    setOpen(false);
    onClear();
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && results.length) { e.preventDefault(); pick(results[active >= 0 ? active : 0]); }
    else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
  };

  const dot = kind === "start" ? COLORS.good : COLORS.bad;
  const dotRing = kind === "start" ? "rgba(31,157,87,0.16)" : "rgba(224,83,61,0.16)";
  const showClear = text.length > 0;

  return (
    <div style={{ position: "relative" }}>
      {/* Waypoint row, measured in PLAN.md step 4. The hairline underline (4b) says
          "field" without reintroducing a container; unboxed, these read as static
          text rather than something you can tap. */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "5px 0 8px",
          background: "transparent",
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flex: "0 0 auto", boxShadow: `0 0 0 3px ${dotRing}` }} />
        <input
          ref={inputRef}
          value={text}
          onChange={onChange}
          onFocus={() => { editing.current = true; if (results.length || text.trim().length >= 2) setOpen(true); }}
          onBlur={() => { editing.current = false; window.setTimeout(() => setOpen(false), 140); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: FONT, fontSize: 13.5, color: COLORS.text }}
        />
        {loading && (
          <span className="spin" style={{ width: 13, height: 13, border: `2px solid ${COLORS.line}`, borderTopColor: COLORS.accent, borderRadius: "50%", flex: "0 0 auto" }} />
        )}
        {!loading && showClear && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={clear} aria-label="Clear" style={iconBtn}>
            <Icon name="close" size={14} color={COLORS.faint} />
          </button>
        )}
        {!loading && !showClear && onGps && (
          <button onMouseDown={(e) => e.preventDefault()} onClick={onGps} disabled={gpsLoading} aria-label="Use my location" style={{ ...iconBtn, opacity: gpsLoading ? 0.5 : 1 }}>
            <Icon name="target" size={16} color={COLORS.accent} />
          </button>
        )}
      </div>

      {open && (results.length > 0 || error) && (
        <div className="ui-fade thin-scroll" style={{ ...glass, marginTop: 6, padding: 4, maxHeight: 244, overflowY: "auto", borderRadius: RADIUS.md }}>
          {error && <div style={{ padding: "9px 10px", fontSize: 12, color: COLORS.dim }}>Search unavailable. Try again.</div>}
          {results.map((p, i) => (
            <button
              key={p.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              onMouseEnter={() => setActive(i)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                border: "none", background: i === active ? COLORS.accentWash : "transparent",
                borderRadius: 9, padding: "8px 10px", cursor: "pointer", fontFamily: FONT,
              }}
            >
              <Icon name="pin" size={15} color={COLORS.faint} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: COLORS.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.primary}</span>
                {p.secondary && (
                  <span style={{ display: "block", fontSize: 11, color: COLORS.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.secondary}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const iconBtn: CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: 2,
  display: "flex", alignItems: "center", flex: "0 0 auto",
};

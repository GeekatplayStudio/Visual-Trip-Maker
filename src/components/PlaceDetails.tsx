import React, { useEffect, useRef, useState } from 'react';
import { Crop, ExternalLink, ImagePlus, Link2, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { Waypoint } from '../types';
import { loadImage } from '../services/markerIcons';
import { CARD_PHOTO_ASPECT, drawCropped } from '../services/photoCrop';
import { storeUpload } from '../services/photoStore';
import { suggestPlaceInfo, type PlaceSuggestion } from '../services/placeInfo';
import { PhotoEditor } from './PhotoEditor';

interface PlaceDetailsProps {
  wp: Waypoint;
  onUpdate: (patch: Partial<Waypoint>, withHistory?: boolean) => void;
  onToast: (msg: string) => void;
}

const MAX_DESC = 300;

/** Live preview of the photo as framed on the story card. */
const PhotoThumb: React.FC<{ url: string; crop?: Waypoint['photoCrop'] }> = ({ url, crop }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = `${url}|${JSON.stringify(crop ?? null)}`;
  const [result, setResult] = useState<{ key: string; state: 'ok' | 'error' } | null>(null);
  const state = result?.key === key ? result.state : 'loading';
  const setState = (st: 'ok' | 'error') => setResult({ key, state: st });
  useEffect(() => {
    let alive = true;
    loadImage(url).then((img) => {
      if (!alive) return;
      const c = ref.current;
      if (!img || !c) return setState('error');
      const w = c.clientWidth || 280;
      const h = w / CARD_PHOTO_ASPECT;
      const pr = window.devicePixelRatio || 1;
      c.width = w * pr;
      c.height = h * pr;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(pr, 0, 0, pr, 0, 0);
      drawCropped(ctx, img, 0, 0, w, h, crop);
      setState('ok');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="relative w-full rounded-lg overflow-hidden bg-slate-800" style={{ aspectRatio: String(CARD_PHOTO_ASPECT) }}>
      <canvas ref={ref} className="absolute inset-0 w-full h-full" />
      {state !== 'ok' && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-400 px-3 text-center">
          {state === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Could not load this photo. Check the address or upload it instead.'}
        </div>
      )}
    </div>
  );
};

export const PlaceDetails: React.FC<PlaceDetailsProps> = ({ wp, onUpdate, onToast }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'suggest' | null>(null);
  const [editing, setEditing] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [dragOver, setDragOver] = useState(false);
  // suggestions belong to one marker and one name
  const sugKey = `${wp.id}|${wp.title}`;
  const [found, setFound] = useState<{ key: string; list: PlaceSuggestion[] }>({ key: '', list: [] });
  const suggestions = found.key === sugKey ? found.list : [];
  const setSuggestions = (list: PlaceSuggestion[]) => setFound({ key: sugKey, list });
  const [pick, setPick] = useState(0);

  const upload = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast('Please choose an image file.');
      return;
    }
    setBusy('upload');
    try {
      const url = await storeUpload(file);
      onUpdate({ photoUrl: url, photoCrop: undefined }, true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not use that photo.');
    } finally {
      setBusy(null);
    }
  };

  const applySuggestion = (s: PlaceSuggestion) =>
    onUpdate({ description: s.text, descriptionSource: { name: s.source, title: s.title, url: s.url } }, true);

  const suggest = async () => {
    if (suggestions.length > 1) {
      const next = (pick + 1) % suggestions.length;
      setPick(next);
      applySuggestion(suggestions[next]);
      return;
    }
    setBusy('suggest');
    try {
      const list = await suggestPlaceInfo(wp.title, wp.lat, wp.lng);
      if (!list.length) {
        onToast('No description found for this place. Try a more specific marker title.');
        return;
      }
      setSuggestions(list);
      setPick(0);
      applySuggestion(list[0]);
    } catch {
      onToast('The description service is not reachable right now.');
    } finally {
      setBusy(null);
    }
  };

  const current = suggestions[pick];
  const sourceImage = current?.imageUrl;

  return (
    <div className="flex flex-col gap-3">
      {/* ---------------------------------------------------------- photo */}
      <div>
        <div className="label">Photo <span className="normal-case tracking-normal font-normal text-slate-500">(optional)</span></div>
        {wp.photoUrl ? (
          <div className="flex flex-col gap-1.5">
            <PhotoThumb url={wp.photoUrl} crop={wp.photoCrop} />
            <div className="grid grid-cols-3 gap-1.5">
              <button onClick={() => setEditing(true)} className="chip flex items-center justify-center gap-1"><Crop className="w-3.5 h-3.5" /> Frame</button>
              <button onClick={() => fileRef.current?.click()} className="chip flex items-center justify-center gap-1"><ImagePlus className="w-3.5 h-3.5" /> Replace</button>
              <button onClick={() => onUpdate({ photoUrl: undefined, photoCrop: undefined }, true)} className="chip flex items-center justify-center gap-1 hover:!text-red-300"><Trash2 className="w-3.5 h-3.5" /> Remove</button>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              upload(e.dataTransfer.files?.[0]);
            }}
            onPaste={(e) => upload(Array.from(e.clipboardData.files)[0])}
            tabIndex={0}
            className={`rounded-xl border border-dashed p-3 flex flex-col items-center gap-2 text-center outline-none transition-colors ${dragOver ? 'border-rose-400 bg-rose-500/10' : 'border-white/15 focus:border-white/30'}`}
          >
            <button onClick={() => fileRef.current?.click()} disabled={busy === 'upload'} className="chip chip-on flex items-center gap-1.5">
              {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} Upload photo
            </button>
            <div className="text-[10px] text-slate-500">or drop / paste an image here · JPEG, PNG, WebP</div>
            {showUrl ? (
              <form
                className="flex gap-1.5 w-full"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (urlDraft.trim()) onUpdate({ photoUrl: urlDraft.trim(), photoCrop: undefined }, true);
                  setUrlDraft('');
                  setShowUrl(false);
                }}
              >
                <input autoFocus value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} className="field text-xs" placeholder="https://…" />
                <button className="chip">Use</button>
              </form>
            ) : (
              <button onClick={() => setShowUrl(true)} className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"><Link2 className="w-3 h-3" /> Use a photo address instead</button>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {/* ---------------------------------------------------------- description */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="label !mb-0">Description <span className="normal-case tracking-normal font-normal text-slate-500">(optional)</span></div>
          <span className="text-[10px] text-slate-500 font-mono">{(wp.description || '').length}/{MAX_DESC}</span>
        </div>
        <textarea
          value={wp.description || ''}
          maxLength={MAX_DESC}
          rows={3}
          onChange={(e) => onUpdate({ description: e.target.value || undefined, descriptionSource: e.target.value ? wp.descriptionSource : undefined })}
          className="field text-xs resize-y leading-relaxed"
          placeholder="A line or two about the place, shown on the story card."
        />
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <button onClick={suggest} disabled={busy === 'suggest'} className="chip flex items-center gap-1.5" title="Find a short description of this place on Wikipedia and Wikivoyage, using the marker title and position">
            {busy === 'suggest' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : suggestions.length > 1 ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
            {suggestions.length > 1 ? `Another (${pick + 1}/${suggestions.length})` : 'Suggest description'}
          </button>
          {sourceImage && !wp.photoUrl && (
            <button onClick={() => onUpdate({ photoUrl: sourceImage, photoCrop: undefined }, true)} className="chip flex items-center gap-1.5"><ImagePlus className="w-3.5 h-3.5" /> Use its photo</button>
          )}
          {wp.descriptionSource && wp.description && (
            <a href={wp.descriptionSource.url} target="_blank" rel="noreferrer" className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1 ml-auto">
              {wp.descriptionSource.name}: {wp.descriptionSource.title} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {editing && wp.photoUrl && <PhotoEditor url={wp.photoUrl} crop={wp.photoCrop} onSave={(crop) => onUpdate({ photoCrop: crop }, true)} onClose={() => setEditing(false)} />}
    </div>
  );
};

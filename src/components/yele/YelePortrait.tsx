// Yélé is the brand's asterisk with a face (hermes-experts yele/avatars), not a portrait: the still
// picture by default, the smiling loop when asked for (WebP, which Safari plays too), never for a
// visitor who asked for less motion.
// Her still face, also her picture in a call.
export const YELE_FACE = "/yele/yele-fixe.webp";

export function Portrait({ animated = false }: { animated?: boolean }) {
  return (
    <picture className="grid size-10 shrink-0 place-items-center rounded-full bg-tint ring-2 ring-brand/30">
      {animated && <source srcSet="/yele/yele-anime.webp" media="(prefers-reduced-motion: no-preference)" type="image/webp" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={YELE_FACE} alt="" width={128} height={128} className="size-9 object-contain" />
    </picture>
  );
}

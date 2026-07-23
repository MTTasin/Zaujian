import Image from "next/image";
import { Icon } from "@/components/ui/Icon";

// Large tappable option card. Image-first, minimal text (rural, non-tech users).
export default function OptionCard({
  image,
  label,
  selected,
  onClick,
}: {
  image?: string | null;
  label?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 transition active:scale-95 ${
        selected ? "ring-2 ring-plum" : "ring-border"
      }`}
    >
      {image ? (
        // `contain`, not `cover`: corner ornaments live in the corner of a
        // transparent PNG, so a centre-crop showed an empty tile. Padding keeps
        // the artwork off the rounded edge; the light tile makes gold readable.
        <Image
          src={image} alt={label ?? ""} fill sizes="120px"
          className="object-contain p-1.5"
        />
      ) : (
        <span className="px-1 text-center text-sm font-medium text-muted">{label}</span>
      )}
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-plum text-white shadow-sm">
          <Icon name="check" size={14} />
        </span>
      )}
    </button>
  );
}

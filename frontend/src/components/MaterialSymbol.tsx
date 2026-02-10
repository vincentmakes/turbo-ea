interface MaterialSymbolProps {
  icon: string;
  size?: number;
  filled?: boolean;
  className?: string;
  color?: string;
}

export function MaterialSymbol({
  icon,
  size = 24,
  filled = false,
  className = "",
  color,
}: MaterialSymbolProps) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
        color,
      }}
    >
      {icon}
    </span>
  );
}

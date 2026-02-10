interface Props {
  icon: string;
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function MaterialSymbol({ icon, size = 24, color, className, style }: Props) {
  return (
    <span
      className={`material-symbols-outlined ${className || ""}`}
      style={{ fontSize: size, color, userSelect: "none", ...style }}
    >
      {icon}
    </span>
  );
}

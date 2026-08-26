/**
 * Full-size screenshot view, opened from the store detail drawer.
 *
 * Nested inside the drawer, so it keeps `disableRestoreFocus` — without it
 * MUI fights the drawer over where focus goes on close and warns about
 * `aria-hidden` on a focused element.
 */
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";

interface Props {
  src: string | null;
  onClose: () => void;
}

export default function ScreenshotLightbox({ src, onClose }: Props) {
  return (
    <Dialog
      open={src !== null}
      onClose={onClose}
      disableRestoreFocus
      maxWidth={false}
      slotProps={{
        paper: {
          sx: { bgcolor: "transparent", boxShadow: "none", m: 0, cursor: "zoom-out" },
        },
      }}
    >
      {src && (
        <Box
          component="img"
          src={src}
          alt=""
          onClick={onClose}
          sx={{
            display: "block",
            maxWidth: "90vw",
            maxHeight: "90vh",
            borderRadius: 1,
            cursor: "zoom-out",
          }}
        />
      )}
    </Dialog>
  );
}

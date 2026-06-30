import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import { brand } from "@/theme";

const BLOG_URL = "https://www.turbo-ea.org/blog/why-i-built-turbo-ea";
const SPONSOR_ONE_TIME = "https://github.com/sponsors/vincentmakes?frequency=one-time";
const SPONSOR_MONTHLY = "https://github.com/sponsors/vincentmakes?frequency=recurring";

const sponsorGradient = `linear-gradient(135deg, ${brand.sponsorFrom}, ${brand.sponsorTo})`;

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SponsorshipDialog({ open, onClose }: Props) {
  const { t } = useTranslation("nav");

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MaterialSymbol icon="volunteer_activism" size={24} color={brand.sponsorTo} />
        {t("sponsorship.title")}
      </DialogTitle>
      <DialogContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
          {t("sponsorship.whyHeading")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("sponsorship.whyBody")}
        </Typography>

        <Box
          component="blockquote"
          sx={{
            m: 0,
            mb: 2,
            pl: 2,
            py: 0.5,
            borderLeft: `3px solid ${brand.sponsorFrom}`,
            fontStyle: "italic",
          }}
        >
          <Typography variant="body2" color="text.primary">
            {t("sponsorship.quote")}
          </Typography>
        </Box>

        <Link
          href={BLOG_URL}
          target="_blank"
          rel="noopener noreferrer"
          variant="body2"
          underline="hover"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
        >
          <MaterialSymbol icon="open_in_new" size={16} />
          {t("sponsorship.blogLink")}
        </Link>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
          {t("sponsorship.howHeading")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("sponsorship.howBody")}
        </Typography>

        <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
          <Button
            href={SPONSOR_ONE_TIME}
            target="_blank"
            rel="noopener noreferrer"
            variant="contained"
            startIcon={<MaterialSymbol icon="favorite" size={18} />}
            sx={{ background: sponsorGradient, color: "#fff", "&:hover": { background: sponsorGradient, filter: "brightness(0.95)" } }}
          >
            {t("sponsorship.oneTime")}
          </Button>
          <Button
            href={SPONSOR_MONTHLY}
            target="_blank"
            rel="noopener noreferrer"
            variant="contained"
            startIcon={<MaterialSymbol icon="autorenew" size={18} />}
            sx={{ background: sponsorGradient, color: "#fff", "&:hover": { background: sponsorGradient, filter: "brightness(0.95)" } }}
          >
            {t("sponsorship.monthly")}
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

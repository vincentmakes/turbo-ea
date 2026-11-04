/**
 * "Propose to endoflife.date": turn a custom EOL product into a draft
 * `products/<slug>.md` file and hand it to GitHub's new-file page, where the
 * user reviews it and opens the pull request from their own account.
 *
 * Nothing is sent anywhere by Turbo EA — the file is built in the browser and
 * the user decides whether to publish it. Proposing makes the product and its
 * dates public, which is why the dialog leads with that warning.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import {
  EOL_DATE_CATEGORIES,
  EOL_DATE_CONTRIBUTING,
  buildEolProductFile,
  eolDateSlug,
  githubNewFileUrl,
  type EolDateCategory,
} from "@/lib/eolContribution";
import type { EolCustomProduct } from "@/types";

interface Props {
  open: boolean;
  product: EolCustomProduct | null;
  onClose: () => void;
}

function ProposeBody({ product, onClose }: { product: EolCustomProduct; onClose: () => void }) {
  const { t } = useTranslation(["admin", "common"]);
  const [category, setCategory] = useState<EolDateCategory | "">("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const file = useMemo(
    () =>
      category
        ? buildEolProductFile(product, {
            category,
            policyPlaceholder: t("eol.custom.propose.policyPlaceholder"),
            descriptionPlaceholder: t("eol.custom.propose.descriptionPlaceholder"),
          })
        : "",
    [product, category, t],
  );
  const githubUrl = file ? githubNewFileUrl(product.key, file) : null;

  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(file);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <>
      <DialogTitle>{t("eol.custom.propose.title", { product: product.title })}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2, mt: 0.5 }}>
          {t("eol.custom.propose.publicWarning")}
        </Alert>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("eol.custom.propose.intro", { file: `products/${eolDateSlug(product.key)}.md` })}
        </Typography>
        <FormControl size="small" fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t("eol.custom.propose.category")}</InputLabel>
          <Select
            label={t("eol.custom.propose.category")}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as EolDateCategory);
              setCopied(false);
            }}
            inputProps={{ "aria-label": t("eol.custom.propose.category") }}
          >
            {EOL_DATE_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {t(`eol.custom.propose.categories.${c}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {file ? (
          <Box
            component="pre"
            data-testid="eol-propose-preview"
            sx={{
              m: 0,
              p: 1.5,
              maxHeight: 300,
              overflow: "auto",
              bgcolor: "action.hover",
              borderRadius: 1,
              fontSize: 12,
              fontFamily: "monospace",
              whiteSpace: "pre",
              direction: "ltr",
            }}
          >
            {file}
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {t("eol.custom.propose.chooseCategory")}
          </Typography>
        )}

        {file && !githubUrl && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t("eol.custom.propose.tooLong")}
          </Alert>
        )}
        {copied && (
          <Alert severity="success" sx={{ mt: 2 }} onClose={() => setCopied(false)}>
            {t("eol.custom.propose.copied")}
          </Alert>
        )}
        {copyFailed && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setCopyFailed(false)}>
            {t("eol.custom.propose.copyFailed")}
          </Alert>
        )}

        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
          {t("eol.custom.propose.checklist")}{" "}
          <Link href={EOL_DATE_CONTRIBUTING} target="_blank" rel="noopener noreferrer">
            {t("eol.custom.propose.guide")}
          </Link>
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common:actions.close")}</Button>
        <Button
          disabled={!file}
          onClick={copy}
          startIcon={<MaterialSymbol icon="content_copy" size={16} />}
        >
          {t("eol.custom.propose.copy")}
        </Button>
        {githubUrl ? (
          <Button
            variant="contained"
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
          >
            {t("eol.custom.propose.openGithub")}
          </Button>
        ) : (
          !file && (
            <Button
              variant="contained"
              disabled
              startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
            >
              {t("eol.custom.propose.openGithub")}
            </Button>
          )
        )}
      </DialogActions>
    </>
  );
}

export default function ProposeEolProductDialog({ open, product, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth disableRestoreFocus>
      {open && product && <ProposeBody product={product} onClose={onClose} />}
    </Dialog>
  );
}

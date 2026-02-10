import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { MaterialSymbol } from "../../components/MaterialSymbol";
import { api } from "../../api/client";
import type { FactSheet } from "../../types/fact-sheet";
import { FACT_SHEET_TYPE_ICONS } from "../../types/fact-sheet";
import type { Relation, RelationListResponse, RelationType } from "../../types/relation";
import { RELATION_TYPE_LABELS } from "../../types/relation";

interface RelationsTabProps {
  factSheet: FactSheet;
}

export default function RelationsTab({ factSheet }: RelationsTabProps) {
  const navigate = useNavigate();
  const [relations, setRelations] = useState<Relation[]>([]);
  const [total, setTotal] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [relType, setRelType] = useState<RelationType>("application_to_business_capability");
  const [targetId, setTargetId] = useState("");
  const [searchResults, setSearchResults] = useState<FactSheet[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadRelations();
  }, [factSheet.id]);

  async function loadRelations() {
    try {
      const data = await api.get<RelationListResponse>("/relations", {
        fact_sheet_id: factSheet.id,
        limit: "100",
      });
      setRelations(data.items);
      setTotal(data.total);
    } catch {
      // handle
    }
  }

  async function searchFactSheets(term: string) {
    setSearchTerm(term);
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const data = await api.get<{ items: FactSheet[] }>("/fact-sheets", {
        search: term,
        page_size: "10",
      });
      setSearchResults(data.items.filter((fs) => fs.id !== factSheet.id));
    } catch {
      // handle
    }
  }

  async function handleAddRelation() {
    if (!targetId) return;
    try {
      await api.post("/relations", {
        type: relType,
        from_fact_sheet_id: factSheet.id,
        to_fact_sheet_id: targetId,
      });
      setAddOpen(false);
      setTargetId("");
      setSearchTerm("");
      setSearchResults([]);
      loadRelations();
    } catch {
      // handle
    }
  }

  async function handleDeleteRelation(relId: string) {
    try {
      await api.delete(`/relations/${relId}`);
      loadRelations();
    } catch {
      // handle
    }
  }

  function getOtherFactSheet(rel: Relation) {
    if (rel.from_fact_sheet_id === factSheet.id) {
      return rel.to_fact_sheet;
    }
    return rel.from_fact_sheet;
  }

  function getDirection(rel: Relation): string {
    return rel.from_fact_sheet_id === factSheet.id ? "\u2192" : "\u2190";
  }

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h6">
          Relations ({total})
        </Typography>
        <Button
          variant="outlined"
          startIcon={<MaterialSymbol icon="add_link" size={18} />}
          onClick={() => setAddOpen(true)}
        >
          Add Relation
        </Button>
      </Box>

      {relations.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 4 }}>
            <Typography color="text.secondary">
              No relations yet. Add relations to connect this fact sheet to others.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Direction</TableCell>
                <TableCell>Related Fact Sheet</TableCell>
                <TableCell>Relation Type</TableCell>
                <TableCell>Attributes</TableCell>
                <TableCell width={60} />
              </TableRow>
            </TableHead>
            <TableBody>
              {relations.map((rel) => {
                const other = getOtherFactSheet(rel);
                return (
                  <TableRow key={rel.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: 18 }}>
                        {getDirection(rel)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {other ? (
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer" }}
                          onClick={() => navigate(`/fact-sheets/${other.id}`)}
                        >
                          <MaterialSymbol
                            icon={FACT_SHEET_TYPE_ICONS[other.type as keyof typeof FACT_SHEET_TYPE_ICONS] || "description"}
                            size={18}
                          />
                          <Typography variant="body2" sx={{ "&:hover": { textDecoration: "underline" } }}>
                            {other.name}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">Unknown</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={RELATION_TYPE_LABELS[rel.type] || rel.type}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      {rel.attributes && Object.keys(rel.attributes).length > 0 ? (
                        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                          {Object.entries(rel.attributes).map(([k, v]) => (
                            <Chip
                              key={k}
                              label={`${k}: ${v}`}
                              size="small"
                              sx={{ fontSize: "0.7rem" }}
                            />
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Box
                        sx={{ cursor: "pointer", color: "error.main" }}
                        onClick={() => handleDeleteRelation(rel.id)}
                      >
                        <MaterialSymbol icon="delete" size={18} />
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Add relation dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Relation</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
          <FormControl margin="dense">
            <InputLabel>Relation Type</InputLabel>
            <Select
              value={relType}
              label="Relation Type"
              onChange={(e) => setRelType(e.target.value as RelationType)}
            >
              {Object.entries(RELATION_TYPE_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Search target fact sheet"
            value={searchTerm}
            onChange={(e) => searchFactSheets(e.target.value)}
            margin="dense"
            placeholder="Type to search..."
          />

          {searchResults.length > 0 && (
            <Box sx={{ maxHeight: 200, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
              {searchResults.map((fs) => (
                <Box
                  key={fs.id}
                  sx={{
                    px: 2,
                    py: 1,
                    cursor: "pointer",
                    backgroundColor: targetId === fs.id ? "action.selected" : "transparent",
                    "&:hover": { backgroundColor: "action.hover" },
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                  onClick={() => setTargetId(fs.id)}
                >
                  <MaterialSymbol icon={FACT_SHEET_TYPE_ICONS[fs.type]} size={18} />
                  <Typography variant="body2">{fs.name}</Typography>
                  <Chip label={fs.type.replace("_", " ")} size="small" sx={{ ml: "auto" }} />
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleAddRelation} disabled={!targetId}>
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

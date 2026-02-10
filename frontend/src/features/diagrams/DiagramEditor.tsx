import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";

interface DiagramData {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
}

export default function DiagramEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [diagram, setDiagram] = useState<DiagramData | null>(null);

  useEffect(() => {
    if (id) api.get<DiagramData>(`/diagrams/${id}`).then(setDiagram);
  }, [id]);

  if (!diagram) return <Typography>Loading...</Typography>;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
        <IconButton onClick={() => navigate("/diagrams")}>
          <MaterialSymbol icon="arrow_back" size={24} />
        </IconButton>
        <Typography variant="h5" fontWeight={600}>{diagram.name}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined">Save</Button>
      </Box>
      <Box
        sx={{
          height: "calc(100vh - 200px)",
          border: "2px dashed #e0e0e0",
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "#fafafa",
        }}
      >
        <Box sx={{ textAlign: "center" }}>
          <MaterialSymbol icon="draw" size={64} color="#ccc" />
          <Typography variant="h6" color="text.secondary" sx={{ mt: 2 }}>
            Diagram Canvas
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Drag and drop fact sheets here to build your diagram.
            <br />
            Full diagram editor coming soon.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

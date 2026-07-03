import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { initTema } from "./lib/theme";

initTema(); // aplica claro/escuro ANTES do primeiro paint (sem flash)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

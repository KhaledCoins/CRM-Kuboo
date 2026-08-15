import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { initTema } from "./lib/theme";
import { instalarTelemetriaGlobal } from "./lib/telemetria";

initTema(); // aplica claro/escuro ANTES do primeiro paint (sem flash)
instalarTelemetriaGlobal(); // erros fora do render + promises sem catch → erros_front

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

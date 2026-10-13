import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initialTheme } from "./theme";
import "./styles.css";

document.documentElement.dataset.theme = initialTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

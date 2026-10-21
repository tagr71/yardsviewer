import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { RecordEmbed } from "./dashboards/RecordEmbed";
import { initialTheme } from "./theme";
import "./styles.css";

const isEmbed = window.location.pathname === "/embed" || window.location.pathname.startsWith("/embed/");
if (isEmbed) {
  document.documentElement.dataset.embed = "true";
  document.documentElement.dataset.theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "night" : "day";
  document.documentElement.lang = "nb";
} else {
  document.documentElement.dataset.theme = initialTheme();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isEmbed ? <RecordEmbed /> : <App />}
  </React.StrictMode>,
);

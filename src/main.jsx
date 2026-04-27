import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

console.log("[boot] main.jsx executing at +" + (Date.now() - (window.__bootStart || Date.now())) + "ms");

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

// Fade out the HTML boot splash now that React has taken over.
// Done in a microtask so React has had at least one paint cycle.
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.documentElement.classList.add("loaded");
  console.log("[boot] React mounted at +" + (Date.now() - (window.__bootStart || Date.now())) + "ms");
  setTimeout(() => {
    const s = document.getElementById("boot-splash");
    if (s) s.remove();
  }, 400);
}));

import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const css = document.createElement("style");
css.textContent = `
  html,body,#root{margin:0;padding:0;min-height:100%;background:#070A12;}
  body{overscroll-behavior-y:none;}
`;
document.head.appendChild(css);

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

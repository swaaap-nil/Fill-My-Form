import React from "react";
import ReactDOM from "react-dom/client";

import { Layout } from "~/components/layout/layout";

const SidePanel = () => {
  return <Layout />;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SidePanel />
  </React.StrictMode>,
);

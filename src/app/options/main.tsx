import React from "react";
import ReactDOM from "react-dom/client";

import { Layout } from "~/components/layout/layout";

const Options = () => {
  return <Layout />;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);

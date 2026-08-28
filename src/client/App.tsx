import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { ToastProvider } from "./components/Toast";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Jobs from "./pages/Jobs";
import Accounts from "./pages/Accounts";
import Runs from "./pages/Runs";

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/runs" element={<Runs />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

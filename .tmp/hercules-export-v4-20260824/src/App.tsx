import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import AuthCallback from "./pages/auth/Callback.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import OrgDashboard from "./pages/org/Dashboard.tsx";
import Departments from "./pages/org/Departments.tsx";
import DepartmentDetail from "./pages/org/DepartmentDetail.tsx";
import DepartmentNew from "./pages/org/DepartmentNew.tsx";
import DepartmentEdit from "./pages/org/DepartmentEdit.tsx";
import ImportReviewPage from "./pages/org/import/ReviewPage.tsx";

export default function App() {
  return (
    <DefaultProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/app" element={<OrgDashboard />} />
          <Route path="/app/departments" element={<Departments />} />
          <Route path="/app/departments/new" element={<DepartmentNew />} />
          <Route path="/app/departments/:id" element={<DepartmentDetail />} />
          <Route path="/app/departments/:id/edit" element={<DepartmentEdit />} />
          <Route path="/app/import/review" element={<ImportReviewPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </DefaultProviders>
  );
}

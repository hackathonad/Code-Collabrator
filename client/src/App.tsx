import { Route, Routes, useLocation } from "react-router-dom";
import { NetworkStatusBanner } from "./components/ui/NetworkStatusBanner";
import { PublicFooter } from "./components/ui/PublicFooter";
import { RouteMetadata } from "./components/ui/RouteMetadata";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { RoomPage } from "./pages/RoomPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TermsPage } from "./pages/TermsPage";

const App = () => {
  const { pathname } = useLocation();
  const showFooter = !pathname.includes("/room/");
  return <>
    <RouteMetadata />
    <NetworkStatusBanner />
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/app" element={<HomePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route path="/guest" element={<HomePage guestMode />} />
      <Route path="/guest/room/:roomId" element={<RoomPage guestMode />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    {showFooter ? <PublicFooter /> : null}
  </>;
};

export default App;

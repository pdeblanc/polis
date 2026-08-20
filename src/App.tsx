import { Navigate, Route, Routes } from 'react-router-dom';
import { BirdsPage } from './pages/BirdsPage';
import { HomePage } from './pages/HomePage';
import { StarfieldPage } from './pages/StarfieldPage';
import { TerrainPage } from './pages/TerrainPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/starfield" element={<StarfieldPage />} />
      <Route path="/terrain" element={<TerrainPage />} />
      <Route path="/birds" element={<BirdsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

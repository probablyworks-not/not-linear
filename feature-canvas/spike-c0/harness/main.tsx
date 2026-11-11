import { createRoot } from 'react-dom/client';
import '../../styles/tokens.css';
import { Spike } from './Spike';

const el = document.getElementById('spike');
if (el) createRoot(el).render(<Spike />);

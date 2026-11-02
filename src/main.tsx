import { createRoot } from 'react-dom/client';
import { RootApplication } from './RootApplication';
import { LayoutLabStandalone } from './LayoutLabStandalone';
import { LAYOUT_LAB_HASH } from './components/ui/openLayoutLab';
import './index.css';

const root = createRoot(document.getElementById('root')!);
root.render(window.location.hash === LAYOUT_LAB_HASH ? <LayoutLabStandalone /> : <RootApplication />);

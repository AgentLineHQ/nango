import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Real app stylesheet so Tailwind utilities + theme CSS variables resolve in the browser.
// Without this, axe's color-contrast checks have no computed colors to evaluate.
import '@/index.css';

import { useGlobal } from '@/lib/store';

// Disable CSS transitions/animations so toggling the theme mid-test doesn't leave axe scanning an
// element's color mid-transition (which produces flaky, false color-contrast failures).
const noMotionStyle = document.createElement('style');
noMotionStyle.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
document.head.appendChild(noMotionStyle);

afterEach(() => {
    cleanup();
    // Reset shared singletons so state never leaks between tests.
    useGlobal.setState({
        sessionToken: null,
        provider: null,
        integration: null,
        isDirty: false,
        isSingleIntegration: false,
        session: null,
        nango: null,
        apiURL: 'https://api.nango.dev',
        isEmbedded: false,
        isAuthLink: false,
        detectClosedAuthWindow: false,
        isPreview: false,
        showWatermark: false
    });
    document.documentElement.classList.remove('dark');
});

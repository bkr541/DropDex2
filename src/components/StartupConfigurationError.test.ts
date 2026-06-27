import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StartupConfigurationError } from './StartupConfigurationError';

describe('StartupConfigurationError', () => {
  it('renders missing variable names without rendering configured values', () => {
    const markup = renderToStaticMarkup(React.createElement(StartupConfigurationError, {
      configuration: {
        status: 'missing',
        missingVariables: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
      },
    }));

    expect(markup).toContain('DropDex configuration is incomplete');
    expect(markup).toContain('VITE_SUPABASE_URL');
    expect(markup).toContain('VITE_SUPABASE_ANON_KEY');
    expect(markup).not.toContain('service-role-value');
  });
});

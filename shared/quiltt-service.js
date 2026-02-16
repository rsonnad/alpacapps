/**
 * Quiltt Banking Service
 *
 * Client-side service for Quiltt Open Banking integration.
 * Handles session token management, Connector launching,
 * and bank account data retrieval.
 *
 * Quiltt Connector SDK is loaded from CDN (https://cdn.quiltt.io/v1/connector.js)
 * Session tokens are issued server-side via quiltt-session edge function.
 */

import { supabase } from './supabase.js';

const QUILTT_CONNECTOR_CDN = 'https://cdn.quiltt.io/v1/connector.js';
const SESSION_CACHE_KEY = 'quiltt_session';

class QuilttService {
  constructor() {
    this.session = null;
    this.sdkLoaded = false;
    this.connectorId = null;
  }

  /**
   * Load Quiltt config from database
   */
  async loadConfig() {
    if (this.connectorId) return;

    const { data, error } = await supabase
      .from('quiltt_config')
      .select('api_key, is_active, test_mode')
      .single();

    if (error || !data?.is_active) {
      console.warn('Quiltt integration not active');
      return null;
    }

    return data;
  }

  /**
   * Load the Quiltt Connector SDK from CDN
   */
  async loadSDK() {
    if (this.sdkLoaded || window.Quiltt) {
      this.sdkLoaded = true;
      return;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = QUILTT_CONNECTOR_CDN;
      script.async = true;
      script.onload = () => {
        this.sdkLoaded = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Quiltt SDK'));
      document.head.appendChild(script);
    });
  }

  /**
   * Get or create a Quiltt session token for the current user.
   * Caches in localStorage, refreshes when expired.
   */
  async getSessionToken() {
    // Check cache
    const cached = localStorage.getItem(SESSION_CACHE_KEY);
    if (cached) {
      const { token, expiresAt } = JSON.parse(cached);
      if (new Date(expiresAt) > new Date()) {
        return token;
      }
      // Expired — clear cache
      localStorage.removeItem(SESSION_CACHE_KEY);
    }

    // Get fresh token from edge function
    const { data: { session: authSession } } = await supabase.auth.getSession();
    if (!authSession?.access_token) {
      throw new Error('Not authenticated');
    }

    const res = await supabase.functions.invoke('quiltt-session', {
      body: { action: 'create' },
    });

    if (res.error) {
      throw new Error(`Failed to get Quiltt session: ${res.error.message}`);
    }

    const { token, profileId, expiresAt } = res.data;

    // Cache the session
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      token,
      profileId,
      expiresAt,
    }));

    return token;
  }

  /**
   * Authenticate with Quiltt using session token.
   * Must be called after loadSDK().
   */
  async authenticate() {
    if (!window.Quiltt) {
      await this.loadSDK();
    }

    const token = await this.getSessionToken();
    window.Quiltt.authenticate(token);
    return token;
  }

  /**
   * Launch the Quiltt Connector to link a bank account.
   *
   * @param {string} connectorId - Quiltt Connector ID from dashboard
   * @param {Object} options - Connector options
   * @param {string} [options.institution] - Pre-fill institution search
   * @param {Function} [options.onExitSuccess] - Called when user completes the flow
   * @param {Function} [options.onExitAbort] - Called when user closes without completing
   * @param {Function} [options.onExitError] - Called on error
   * @param {Function} [options.onEvent] - Called on all events
   * @returns {Object} Connector instance with open() method
   */
  async launchConnector(connectorId, options = {}) {
    await this.authenticate();

    const connector = window.Quiltt.connect(connectorId, {
      institution: options.institution,
      onLoad: (metadata) => {
        console.log('Quiltt Connector loaded:', metadata.connectorId);
      },
      onExitSuccess: (metadata) => {
        console.log('Quiltt Connector success:', metadata);
        if (options.onExitSuccess) options.onExitSuccess(metadata);
      },
      onExitAbort: (metadata) => {
        console.log('Quiltt Connector aborted:', metadata);
        if (options.onExitAbort) options.onExitAbort(metadata);
      },
      onExitError: (metadata) => {
        console.error('Quiltt Connector error:', metadata);
        if (options.onExitError) options.onExitError(metadata);
      },
      onEvent: (type, metadata) => {
        if (options.onEvent) options.onEvent(type, metadata);
      },
    });

    connector.open();
    return connector;
  }

  /**
   * Launch the Quiltt Connector in reconnect mode for a broken connection.
   *
   * @param {string} connectorId - Quiltt Connector ID
   * @param {string} connectionId - Existing connection ID to repair
   * @param {Object} options - Same as launchConnector options
   */
  async reconnect(connectorId, connectionId, options = {}) {
    await this.authenticate();

    const connector = window.Quiltt.reconnect(connectorId, {
      connectionId,
      onExitSuccess: (metadata) => {
        console.log('Quiltt reconnect success:', metadata);
        if (options.onExitSuccess) options.onExitSuccess(metadata);
      },
      onExitAbort: options.onExitAbort,
      onExitError: options.onExitError,
    });

    connector.open();
    return connector;
  }

  /**
   * Get the user's linked bank connections from our database.
   */
  async getConnections() {
    const cached = localStorage.getItem(SESSION_CACHE_KEY);
    if (!cached) return [];

    const { profileId } = JSON.parse(cached);

    const { data, error } = await supabase
      .from('quiltt_connections')
      .select('*')
      .eq('quiltt_profile_id', profileId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch connections:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get the user's linked bank accounts from our database.
   */
  async getAccounts() {
    const cached = localStorage.getItem(SESSION_CACHE_KEY);
    if (!cached) return [];

    const { profileId } = JSON.parse(cached);

    const { data, error } = await supabase
      .from('quiltt_accounts')
      .select('*, quiltt_connections(institution_name, status)')
      .eq('quiltt_profile_id', profileId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch accounts:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Revoke the current session token (call on logout).
   */
  async revokeSession() {
    const cached = localStorage.getItem(SESSION_CACHE_KEY);
    if (!cached) return;

    const { token } = JSON.parse(cached);

    try {
      await supabase.functions.invoke('quiltt-session', {
        body: { action: 'revoke', token },
      });
    } catch (err) {
      console.warn('Failed to revoke Quiltt session:', err);
    }

    localStorage.removeItem(SESSION_CACHE_KEY);
  }

  /**
   * Clear local cache (without revoking server-side).
   */
  clearCache() {
    localStorage.removeItem(SESSION_CACHE_KEY);
    this.session = null;
  }
}

export const quilttService = new QuilttService();

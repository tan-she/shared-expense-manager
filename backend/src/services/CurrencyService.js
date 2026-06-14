/**
 * services/CurrencyService.js
 * 
 * Handles multi-currency conversions and rate lookup.
 * Default base currency is INR. Exchange rate represents: 1 Currency Unit = X INR.
 * E.g., USD exchange_rate = 83.50 implies 1 USD = 83.50 INR.
 * 
 * Design Pattern: Service Layer
 */

import { createError } from '../middleware/errorHandler.js';

class CurrencyService {
  constructor() {
    // Configurable/hardcoded rates for reproducibility.
    // In production, these would be fetched from an external API or stored in DB daily.
    this.rates = {
      INR: 1.0000,
      USD: 83.5000
    };
  }

  /**
   * Retrieves exchange rate for a given currency to base currency (INR).
   */
  getRate(currency) {
    const code = currency?.toUpperCase();
    if (!this.rates[code]) {
      throw createError(400, `Unsupported currency code: ${currency}`);
    }
    return this.rates[code];
  }

  /**
   * Converts a given amount in a source currency to INR.
   * Uses precise numeric math logic (rounds to 2 decimal places).
   */
  convertToBase(amount, currency) {
    const rate = this.getRate(currency);
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 0) {
      throw createError(400, 'Invalid amount for conversion.');
    }
    // Round to 2 decimal places to maintain cent-precision
    return Math.round(numAmount * rate * 100) / 100;
  }
}

export default new CurrencyService();

const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("docs"));

// Helper function to safely convert to number and handle NaN
function safeNumber(value, defaultValue = 0) {
  const num = parseFloat(value);
  return isNaN(num) ? defaultValue : num;
}

// Function to fetch mutual fund name from AMC API or search
async function fetchMutualFundName(schemeCode) {
  try {
    // Try to get scheme name from AMFI API
    const url = `https://api.mfapi.in/mf/${schemeCode}`;
    const response = await axios.get(url, {
      timeout: 10000,
    });

    if (response.data && response.data.meta && response.data.meta.scheme_name) {
      return response.data.meta.scheme_name;
    }

    return null;
  } catch (error) {
    console.error(
      `Error fetching mutual fund name for ${schemeCode}:`,
      error.message
    );
    return null;
  }
}

// Function to fetch company name from Yahoo Finance
async function fetchCompanyName(symbol) {
  try {
    console.log(`Attempting to fetch company name for: ${symbol}`);
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${symbol}`;
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 5000, // Reduced timeout to 5 seconds
    });

    if (
      response.data &&
      response.data.quotes &&
      response.data.quotes.length > 0
    ) {
      const quote = response.data.quotes.find((q) => q.symbol === symbol);
      if (quote && quote.longname) {
        console.log(`Found company name for ${symbol}: ${quote.longname}`);
        return quote.longname;
      } else if (quote && quote.shortname) {
        console.log(`Found company name for ${symbol}: ${quote.shortname}`);
        return quote.shortname;
      } else if (response.data.quotes[0].longname) {
        console.log(
          `Found company name for ${symbol}: ${response.data.quotes[0].longname}`
        );
        return response.data.quotes[0].longname;
      } else if (response.data.quotes[0].shortname) {
        console.log(
          `Found company name for ${symbol}: ${response.data.quotes[0].shortname}`
        );
        return response.data.quotes[0].shortname;
      }
    }

    console.log(`No company name found for ${symbol} in search results`);
    return null;
  } catch (error) {
    console.error(`Error fetching company name for ${symbol}:`, error.message);
    return null;
  }
}

// Consolidate duplicate stocks and mutual funds
function consolidatePortfolio(portfolio) {
  // Consolidate stocks by symbol
  const stockMap = new Map();

  portfolio.stocks.forEach((stock) => {
    const symbol = stock.symbol;
    if (stockMap.has(symbol)) {
      const existing = stockMap.get(symbol);
      // Calculate weighted average purchase price
      const totalQuantity =
        safeNumber(existing.quantity) + safeNumber(stock.quantity);
      const totalInvestment =
        safeNumber(existing.quantity) * safeNumber(existing.purchasePrice) +
        safeNumber(stock.quantity) * safeNumber(stock.purchasePrice);

      existing.quantity = totalQuantity;
      existing.purchasePrice =
        totalQuantity > 0 ? totalInvestment / totalQuantity : 0;
      existing.investedAmount = totalInvestment;
      // Update company name if the new stock has a better one
      if (
        stock.companyName &&
        stock.companyName !== stock.symbol &&
        stock.companyName !== stock.originalSymbol
      ) {
        existing.companyName = stock.companyName;
      }
      existing.currentPrice = safeNumber(
        stock.currentPrice,
        existing.currentPrice
      );
      existing.change = safeNumber(stock.change, existing.change);
      existing.changePercent = safeNumber(
        stock.changePercent,
        existing.changePercent
      );
      existing.totalValue = totalQuantity * safeNumber(existing.currentPrice);
      existing.totalGain = existing.totalValue - totalInvestment;
      existing.gainPercent =
        totalInvestment > 0 ? (existing.totalGain / totalInvestment) * 100 : 0;
      const txnCurrentValue =
        safeNumber(stock.quantity) * safeNumber(existing.currentPrice);
      const txnInvestedAmount =
        safeNumber(stock.quantity) * safeNumber(stock.purchasePrice);
      const txnGain = txnCurrentValue - txnInvestedAmount;
      const txnGainPercent =
        txnInvestedAmount > 0 ? (txnGain / txnInvestedAmount) * 100 : 0;

      existing.transactions.push({
        id: stock.id,
        quantity: safeNumber(stock.quantity),
        purchasePrice: safeNumber(stock.purchasePrice),
        purchaseDate: stock.purchaseDate,
        totalValue: txnCurrentValue,
        totalGain: txnGain,
        gainPercent: txnGainPercent,
      });
    } else {
      const txnCurrentValue =
        safeNumber(stock.quantity) * safeNumber(stock.currentPrice);
      const txnInvestedAmount =
        safeNumber(stock.quantity) * safeNumber(stock.purchasePrice);
      const txnGain = txnCurrentValue - txnInvestedAmount;
      const txnGainPercent =
        txnInvestedAmount > 0 ? (txnGain / txnInvestedAmount) * 100 : 0;

      stockMap.set(symbol, {
        ...stock,
        companyName: stock.companyName || stock.originalSymbol || stock.symbol,
        quantity: safeNumber(stock.quantity),
        purchasePrice: safeNumber(stock.purchasePrice),
        investedAmount:
          safeNumber(stock.quantity) * safeNumber(stock.purchasePrice),
        currentPrice: safeNumber(stock.currentPrice),
        totalValue: safeNumber(stock.quantity) * safeNumber(stock.currentPrice),
        totalGain: safeNumber(stock.totalGain),
        gainPercent: safeNumber(stock.gainPercent),
        change: safeNumber(stock.change),
        changePercent: safeNumber(stock.changePercent),
        transactions: [
          {
            id: stock.id,
            quantity: safeNumber(stock.quantity),
            purchasePrice: safeNumber(stock.purchasePrice),
            purchaseDate: stock.purchaseDate,
            totalValue: txnCurrentValue,
            totalGain: txnGain,
            gainPercent: txnGainPercent,
          },
        ],
      });
    }
  });

  // Consolidate mutual funds by scheme
  const mfMap = new Map();

  portfolio.mutualFunds.forEach((mf) => {
    const scheme = mf.scheme;
    if (mfMap.has(scheme)) {
      const existing = mfMap.get(scheme);
      const totalInvestment =
        safeNumber(existing.investedAmount) + safeNumber(mf.investedAmount);
      const totalUnits = safeNumber(existing.units) + safeNumber(mf.units);

      existing.units = totalUnits;
      existing.investedAmount = totalInvestment;
      existing.purchaseNAV = totalUnits > 0 ? totalInvestment / totalUnits : 0;
      existing.currentNAV = safeNumber(mf.currentNAV, existing.currentNAV);
      existing.change = safeNumber(mf.change, existing.change);
      existing.changePercent = safeNumber(
        mf.changePercent,
        existing.changePercent
      );
      existing.totalValue = totalUnits * safeNumber(existing.currentNAV);
      existing.totalGain = existing.totalValue - totalInvestment;
      existing.gainPercent =
        totalInvestment > 0 ? (existing.totalGain / totalInvestment) * 100 : 0;
      existing.navDate = mf.navDate || existing.navDate;
      const txnCurrentValue =
        safeNumber(mf.units) * safeNumber(existing.currentNAV);
      const txnInvestedAmount = safeNumber(mf.investedAmount);
      const txnGain = txnCurrentValue - txnInvestedAmount;
      const txnGainPercent =
        txnInvestedAmount > 0 ? (txnGain / txnInvestedAmount) * 100 : 0;

      existing.transactions.push({
        id: mf.id,
        units: safeNumber(mf.units),
        purchaseNAV: safeNumber(mf.purchaseNAV),
        investedAmount: safeNumber(mf.investedAmount),
        purchaseDate: mf.purchaseDate,
        totalValue: txnCurrentValue,
        totalGain: txnGain,
        gainPercent: txnGainPercent,
      });
    } else {
      const txnCurrentValue = safeNumber(mf.units) * safeNumber(mf.currentNAV);
      const txnInvestedAmount = safeNumber(mf.investedAmount);
      const txnGain = txnCurrentValue - txnInvestedAmount;
      const txnGainPercent =
        txnInvestedAmount > 0 ? (txnGain / txnInvestedAmount) * 100 : 0;

      mfMap.set(scheme, {
        ...mf,
        units: safeNumber(mf.units),
        purchaseNAV: safeNumber(mf.purchaseNAV),
        investedAmount: safeNumber(mf.investedAmount),
        currentNAV: safeNumber(mf.currentNAV),
        totalValue: safeNumber(mf.units) * safeNumber(mf.currentNAV),
        totalGain: safeNumber(mf.totalGain),
        gainPercent: safeNumber(mf.gainPercent),
        change: safeNumber(mf.change),
        changePercent: safeNumber(mf.changePercent),
        transactions: [
          {
            id: mf.id,
            units: safeNumber(mf.units),
            purchaseNAV: safeNumber(mf.purchaseNAV),
            investedAmount: safeNumber(mf.investedAmount),
            purchaseDate: mf.purchaseDate,
            totalValue: txnCurrentValue,
            totalGain: txnGain,
            gainPercent: txnGainPercent,
          },
        ],
      });
    }
  });

  return {
    stocks: Array.from(stockMap.values()),
    mutualFunds: Array.from(mfMap.values()),
  };
}

// API Routes
app.get("/api/portfolio", async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);
    res.json(portfolio);
  } catch (error) {
    console.error("Error reading portfolio:", error);
    res.status(500).json({ error: "Failed to read portfolio data" });
  }
});

app.get("/api/portfolio/consolidated", async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);
    const consolidated = consolidatePortfolio(portfolio);
    res.json(consolidated);
  } catch (error) {
    console.error("Error reading portfolio:", error);
    res.status(500).json({ error: "Failed to read portfolio data" });
  }
});

// Stock search API endpoint
app.get("/api/stock/search", async (req, res) => {
  try {
    const { query, exchange } = req.query;

    if (!query || query.length < 2) {
      return res.json([]);
    }

    console.log(
      `Searching for stocks: query="${query}", exchange="${exchange}"`
    );

    // Use Yahoo Finance search API to get stock suggestions
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}`;

    const response = await axios.get(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 5000,
    });

    if (response.data && response.data.quotes) {
      let filteredQuotes = response.data.quotes;

      // Filter by exchange if specified
      if (exchange) {
        filteredQuotes = filteredQuotes.filter((quote) => {
          const symbol = quote.symbol || "";
          switch (exchange) {
            case "NSE":
              return (
                symbol.endsWith(".NS") ||
                (!symbol.includes(".") && quote.exchange === "NSI")
              );
            case "BSE":
              return symbol.endsWith(".BO") || quote.exchange === "BSE";
            case "NASDAQ":
              return quote.exchange === "NMS" || quote.exchange === "NGM";
            case "NYSE":
              return quote.exchange === "NYQ";
            case "LSE":
              return symbol.endsWith(".L") || quote.exchange === "LSE";
            case "TSE":
              return symbol.endsWith(".T") || quote.exchange === "TYO";
            case "SSE":
              return symbol.endsWith(".SS");
            case "ASX":
              return symbol.endsWith(".AX");
            case "TSX":
              return symbol.endsWith(".TO");
            default:
              return true;
          }
        });
      }

      // Format the results
      const suggestions = filteredQuotes
        .slice(0, 8) // Limit to 8 suggestions
        .map((quote) => {
          let symbol = quote.symbol || "";
          let displaySymbol = symbol;

          // Remove exchange suffix for display
          if (exchange) {
            switch (exchange) {
              case "NSE":
                displaySymbol = symbol.replace(".NS", "");
                break;
              case "BSE":
                displaySymbol = symbol.replace(".BO", "");
                break;
              case "LSE":
                displaySymbol = symbol.replace(".L", "");
                break;
              case "TSE":
                displaySymbol = symbol.replace(".T", "");
                break;
              case "SSE":
                displaySymbol = symbol.replace(".SS", "");
                break;
              case "ASX":
                displaySymbol = symbol.replace(".AX", "");
                break;
              case "TSX":
                displaySymbol = symbol.replace(".TO", "");
                break;
            }
          }

          return {
            symbol: displaySymbol,
            name: quote.longname || quote.shortname || displaySymbol,
            fullSymbol: symbol,
            exchange: quote.exchange || exchange,
          };
        });

      console.log(`Found ${suggestions.length} stock suggestions`);
      res.json(suggestions);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error("Error searching stocks:", error.message);
    res.status(500).json({ error: "Failed to search stocks" });
  }
});

// Mutual fund search API endpoint
app.get("/api/mutual-fund/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.length < 2) {
      return res.json([]);
    }

    console.log(`Searching for mutual funds: query="${query}"`);

    // Use MFAPI.in search endpoint to get mutual fund suggestions
    const searchUrl = `https://api.mfapi.in/mf/search?q=${encodeURIComponent(
      query
    )}`;

    const response = await axios.get(searchUrl, {
      timeout: 5000,
    });

    if (response.data && Array.isArray(response.data)) {
      // Format the results
      const suggestions = response.data
        .slice(0, 8) // Limit to 8 suggestions
        .map((fund) => ({
          schemeCode: fund.schemeCode,
          schemeName: fund.schemeName,
          fundHouse: fund.fundHouse,
          schemeType: fund.schemeType,
        }));

      console.log(`Found ${suggestions.length} mutual fund suggestions`);
      res.json(suggestions);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error("Error searching mutual funds:", error.message);
    res.status(500).json({ error: "Failed to search mutual funds" });
  }
});

app.post("/api/portfolio/stock", async (req, res) => {
  try {
    console.log("Received stock addition request:", req.body);
    const {
      symbol,
      originalSymbol,
      exchange,
      quantity,
      purchasePrice,
      purchaseDate,
    } = req.body;

    console.log("Reading portfolio file...");
    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);
    console.log("Portfolio file read successfully");

    const newStock = {
      id: Date.now().toString(),
      symbol: symbol.toUpperCase(),
      originalSymbol: originalSymbol || symbol,
      companyName: originalSymbol || symbol, // Use symbol as fallback initially
      exchange: exchange || "NSE",
      quantity: safeNumber(quantity),
      purchasePrice: safeNumber(purchasePrice),
      purchaseDate,
      currentPrice: safeNumber(purchasePrice), // Initialize with purchase price
      change: 0,
      changePercent: 0,
      totalValue: safeNumber(quantity) * safeNumber(purchasePrice),
      totalGain: 0,
      gainPercent: 0,
    };

    console.log("Created new stock object:", newStock);

    portfolio.stocks.push(newStock);

    console.log("Writing portfolio file...");
    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );
    console.log("Portfolio file written successfully");

    // Try to fetch company name asynchronously after responding
    fetchCompanyName(symbol)
      .then((companyName) => {
        if (companyName) {
          console.log(`Updating company name for ${symbol} to ${companyName}`);
          // Update the stock with the company name
          fs.readFile(path.join(__dirname, "data", "portfolio.json"), "utf8")
            .then((data) => {
              const portfolio = JSON.parse(data);
              const stockIndex = portfolio.stocks.findIndex(
                (s) => s.id === newStock.id
              );
              if (stockIndex !== -1) {
                portfolio.stocks[stockIndex].companyName = companyName;
                return fs.writeFile(
                  path.join(__dirname, "data", "portfolio.json"),
                  JSON.stringify(portfolio, null, 2)
                );
              }
            })
            .catch((err) => console.error("Error updating company name:", err));
        }
      })
      .catch((err) => console.error("Error fetching company name:", err));

    res.json({ message: "Stock added successfully", stock: newStock });
  } catch (error) {
    console.error("Error adding stock:", error);
    res.status(500).json({ error: "Failed to add stock" });
  }
});

app.post("/api/portfolio/mutual-fund", async (req, res) => {
  try {
    const { scheme, units, purchaseNAV, investedAmount, purchaseDate } =
      req.body;

    // Try to fetch scheme name if scheme appears to be a code (all digits)
    let schemeName = scheme;
    if (/^\d+$/.test(scheme)) {
      const fetchedName = await fetchMutualFundName(scheme);
      if (fetchedName) {
        schemeName = fetchedName;
      }
    }

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    const newMF = {
      id: Date.now().toString(),
      scheme: schemeName,
      schemeCode: /^\d+$/.test(scheme) ? scheme : null,
      units: safeNumber(units),
      purchaseNAV: safeNumber(purchaseNAV),
      investedAmount: safeNumber(investedAmount),
      purchaseDate,
      currentNAV: safeNumber(purchaseNAV), // Initialize with purchase NAV
      change: 0,
      changePercent: 0,
      totalValue: safeNumber(units) * safeNumber(purchaseNAV),
      totalGain: 0,
      gainPercent: 0,
      navDate: new Date().toLocaleDateString("en-GB"),
    };

    portfolio.mutualFunds.push(newMF);

    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );
    res.json({ message: "Mutual fund added successfully", mutualFund: newMF });
  } catch (error) {
    console.error("Error adding mutual fund:", error);
    res.status(500).json({ error: "Failed to add mutual fund" });
  }
});

app.delete("/api/portfolio/transaction/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    // Remove from stocks
    portfolio.stocks = portfolio.stocks.filter((stock) => stock.id !== id);

    // Remove from mutual funds
    portfolio.mutualFunds = portfolio.mutualFunds.filter((mf) => mf.id !== id);

    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );
    res.json({ message: "Transaction deleted successfully" });
  } catch (error) {
    console.error("Error deleting transaction:", error);
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

// Refresh portfolio endpoint
app.post("/api/refresh", async (req, res) => {
  try {
    console.log("Refreshing portfolio with latest market data...");

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    // Get real-time stock prices from Yahoo Finance API
    for (const stock of portfolio.stocks) {
      if (stock.symbol) {
        try {
          // Build the correct Yahoo Finance URL based on symbol format
          let apiSymbol = stock.symbol;

          // If the symbol doesn't already have an exchange suffix, add .NS for Indian stocks
          if (!apiSymbol.includes(".")) {
            apiSymbol = `${apiSymbol}.NS`;
          }

          console.log(`Fetching price for: ${apiSymbol}`);
          const response = await axios.get(
            `https://query1.finance.yahoo.com/v8/finance/chart/${apiSymbol}`,
            {
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
              },
              timeout: 10000,
            }
          );

          console.log(`Response status for ${apiSymbol}:`, response.status);

          if (
            response.data &&
            response.data.chart &&
            response.data.chart.result &&
            response.data.chart.result[0] &&
            response.data.chart.result[0].meta
          ) {
            const result = response.data.chart.result[0];
            const currentPrice = result.meta.regularMarketPrice;

            if (currentPrice && currentPrice > 0) {
              stock.currentPrice = parseFloat(currentPrice.toFixed(2));
              stock.change = stock.currentPrice - stock.purchasePrice;
              stock.changePercent = (
                (stock.change / stock.purchasePrice) *
                100
              ).toFixed(2);
              stock.totalValue = stock.quantity * stock.currentPrice;
              stock.totalGain =
                stock.totalValue - stock.quantity * stock.purchasePrice;
              stock.gainPercent = (
                (stock.totalGain / (stock.quantity * stock.purchasePrice)) *
                100
              ).toFixed(2);
              stock.priceError = false;
              stock.lastUpdated = new Date().toISOString().split("T")[0];
              console.log(
                `✅ Updated ${apiSymbol}: ₹${stock.currentPrice} (change: ${stock.changePercent}%)`
              );
            } else {
              console.log(`❌ No valid price data for ${apiSymbol}`);
              stock.priceError = true;
            }
          } else {
            console.log(`❌ Invalid response structure for ${apiSymbol}`);
            stock.priceError = true;
          }
        } catch (error) {
          console.error(
            `Error fetching price for ${stock.symbol}:`,
            error.message
          );
          stock.priceError = true;
        }
      }
    }

    // Get real-time mutual fund NAVs
    for (const mf of portfolio.mutualFunds) {
      if (mf.scheme) {
        try {
          // Use existing scheme code if available, otherwise try to search for it
          let schemeCode = mf.schemeCode;

          if (!schemeCode) {
            // Try to search for scheme code dynamically
            console.log(`Searching for scheme code for: ${mf.scheme}`);
            try {
              const searchResponse = await axios.get(
                `https://api.mfapi.in/mf/search?q=${encodeURIComponent(
                  mf.scheme
                )}`,
                { timeout: 5000 }
              );

              if (searchResponse.data && searchResponse.data.length > 0) {
                // Find exact match or closest match
                const exactMatch = searchResponse.data.find(
                  (fund) =>
                    fund.schemeName.toLowerCase() === mf.scheme.toLowerCase()
                );

                if (exactMatch) {
                  schemeCode = exactMatch.schemeCode;
                  // Update the mutual fund with the found scheme code for future use
                  mf.schemeCode = schemeCode;
                  console.log(
                    `Found scheme code ${schemeCode} for ${mf.scheme}`
                  );
                }
              }
            } catch (searchError) {
              console.log(
                `Error searching for scheme code: ${searchError.message}`
              );
            }
          }

          if (schemeCode) {
            // Use AMFI API for mutual fund NAVs
            const response = await axios.get(
              `https://api.mfapi.in/mf/${schemeCode}`,
              {
                timeout: 5000,
              }
            );

            if (
              response.data &&
              response.data.data &&
              response.data.data.length > 0
            ) {
              const latestNav = response.data.data[0];
              const currentNAV = parseFloat(latestNav.nav);

              if (currentNAV && currentNAV > 0) {
                mf.currentNAV = parseFloat(currentNAV.toFixed(2));
                mf.change = mf.currentNAV - mf.purchaseNAV;
                mf.changePercent = ((mf.change / mf.purchaseNAV) * 100).toFixed(
                  2
                );
                mf.totalValue = mf.units * mf.currentNAV;
                mf.totalGain = mf.totalValue - mf.investedAmount;
                mf.gainPercent = (
                  (mf.totalGain / mf.investedAmount) *
                  100
                ).toFixed(2);
                mf.navError = false;
                mf.navDate = latestNav.date;
                console.log(
                  `Updated ${mf.scheme}: ₹${mf.currentNAV} (${latestNav.date})`
                );
              } else {
                console.log(`No valid NAV data for ${mf.scheme}`);
                mf.navError = true;
              }
            } else {
              mf.navError = true;
            }
          } else {
            console.log(`No scheme code found for ${mf.scheme}`);
            mf.navError = true;
          }
        } catch (error) {
          console.error(`Error fetching NAV for ${mf.scheme}:`, error.message);
          mf.navError = true;
        }
      }
    }

    // Update the lastUpdated timestamp
    portfolio.lastUpdated = new Date().toISOString();

    // Save updated portfolio
    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );

    console.log("Portfolio refreshed successfully");
    res.json({ message: "Portfolio refreshed successfully" });
  } catch (error) {
    console.error("Error refreshing portfolio:", error);
    res.status(500).json({ error: "Failed to refresh portfolio" });
  }
});

// Delete stock transaction endpoint
// Update stock transaction
app.put("/api/stocks/transaction/:id", async (req, res) => {
  try {
    const transactionId = req.params.id;
    const {
      symbol,
      originalSymbol,
      exchange,
      quantity,
      purchasePrice,
      purchaseDate,
    } = req.body;

    // Fetch company name if symbol changed
    let companyName = null;
    if (symbol) {
      companyName = await fetchCompanyName(symbol);
    }

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    // Find and update the stock transaction
    let transactionFound = false;
    portfolio.stocks = portfolio.stocks.map((stock) => {
      if (stock.id === transactionId) {
        transactionFound = true;
        const updatedStock = {
          ...stock,
          symbol: symbol ? symbol.toUpperCase() : stock.symbol,
          originalSymbol:
            originalSymbol || stock.originalSymbol || stock.symbol,
          companyName:
            companyName ||
            stock.companyName ||
            originalSymbol ||
            stock.originalSymbol ||
            stock.symbol,
          exchange: exchange || stock.exchange || "NSE",
          quantity: safeNumber(quantity, stock.quantity),
          purchasePrice: safeNumber(purchasePrice, stock.purchasePrice),
          purchaseDate: purchaseDate || stock.purchaseDate,
          totalValue:
            safeNumber(quantity, stock.quantity) *
            safeNumber(stock.currentPrice),
          totalGain:
            safeNumber(quantity, stock.quantity) *
              safeNumber(stock.currentPrice) -
            safeNumber(quantity, stock.quantity) *
              safeNumber(purchasePrice, stock.purchasePrice),
          gainPercent:
            safeNumber(quantity, stock.quantity) *
              safeNumber(purchasePrice, stock.purchasePrice) >
            0
              ? ((safeNumber(quantity, stock.quantity) *
                  safeNumber(stock.currentPrice) -
                  safeNumber(quantity, stock.quantity) *
                    safeNumber(purchasePrice, stock.purchasePrice)) /
                  (safeNumber(quantity, stock.quantity) *
                    safeNumber(purchasePrice, stock.purchasePrice))) *
                100
              : 0,
        };
        return updatedStock;
      }
      return stock;
    });

    if (!transactionFound) {
      return res.status(404).json({ error: "Stock transaction not found" });
    }

    // Save updated portfolio
    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );

    console.log(`Stock transaction ${transactionId} updated successfully`);
    res.json({ message: "Stock transaction updated successfully" });
  } catch (error) {
    console.error("Error updating stock transaction:", error);
    res.status(500).json({ error: "Failed to update stock transaction" });
  }
});

app.delete("/api/stocks/transaction/:id", async (req, res) => {
  try {
    const transactionId = req.params.id;

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    // Find and remove the stock transaction
    let transactionFound = false;
    portfolio.stocks = portfolio.stocks.filter((stock) => {
      if (stock.id === transactionId) {
        transactionFound = true;
        return false;
      }
      return true;
    });

    if (!transactionFound) {
      return res.status(404).json({ error: "Stock transaction not found" });
    }

    // Save updated portfolio
    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );

    console.log(`Stock transaction ${transactionId} deleted successfully`);
    res.json({ message: "Stock transaction deleted successfully" });
  } catch (error) {
    console.error("Error deleting stock transaction:", error);
    res.status(500).json({ error: "Failed to delete stock transaction" });
  }
});

// Delete mutual fund transaction endpoint
// Update mutual fund transaction
app.put("/api/mutual-funds/transaction/:id", async (req, res) => {
  try {
    const transactionId = req.params.id;
    const { scheme, units, purchaseNAV, investedAmount, purchaseDate } =
      req.body;

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    // Find and update the mutual fund transaction
    let transactionFound = false;
    portfolio.mutualFunds = portfolio.mutualFunds.map((mf) => {
      if (mf.id === transactionId) {
        transactionFound = true;
        const updatedMF = {
          ...mf,
          scheme: scheme || mf.scheme,
          units: safeNumber(units, mf.units),
          purchaseNAV: safeNumber(purchaseNAV, mf.purchaseNAV),
          investedAmount: safeNumber(investedAmount, mf.investedAmount),
          purchaseDate: purchaseDate || mf.purchaseDate,
          totalValue: safeNumber(units, mf.units) * safeNumber(mf.currentNAV),
          totalGain:
            safeNumber(units, mf.units) * safeNumber(mf.currentNAV) -
            safeNumber(investedAmount, mf.investedAmount),
          gainPercent:
            safeNumber(investedAmount, mf.investedAmount) > 0
              ? ((safeNumber(units, mf.units) * safeNumber(mf.currentNAV) -
                  safeNumber(investedAmount, mf.investedAmount)) /
                  safeNumber(investedAmount, mf.investedAmount)) *
                100
              : 0,
        };
        return updatedMF;
      }
      return mf;
    });

    if (!transactionFound) {
      return res
        .status(404)
        .json({ error: "Mutual fund transaction not found" });
    }

    // Save updated portfolio
    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );

    console.log(
      `Mutual fund transaction ${transactionId} updated successfully`
    );
    res.json({ message: "Mutual fund transaction updated successfully" });
  } catch (error) {
    console.error("Error updating mutual fund transaction:", error);
    res.status(500).json({ error: "Failed to update mutual fund transaction" });
  }
});

app.delete("/api/mutual-funds/transaction/:id", async (req, res) => {
  try {
    const transactionId = req.params.id;

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    // Find and remove the mutual fund transaction
    let transactionFound = false;
    portfolio.mutualFunds = portfolio.mutualFunds.filter((mf) => {
      if (mf.id === transactionId) {
        transactionFound = true;
        return false;
      }
      return true;
    });

    if (!transactionFound) {
      return res
        .status(404)
        .json({ error: "Mutual fund transaction not found" });
    }

    // Save updated portfolio
    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );

    console.log(
      `Mutual fund transaction ${transactionId} deleted successfully`
    );
    res.json({ message: "Mutual fund transaction deleted successfully" });
  } catch (error) {
    console.error("Error deleting mutual fund transaction:", error);
    res.status(500).json({ error: "Failed to delete mutual fund transaction" });
  }
});

// Update existing stocks with company names
app.post("/api/update-company-names", async (req, res) => {
  try {
    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    // Update stocks without company names
    for (let stock of portfolio.stocks) {
      if (!stock.companyName) {
        console.log(`Fetching company name for ${stock.symbol}...`);
        const companyName = await fetchCompanyName(stock.symbol);
        if (companyName) {
          stock.companyName = companyName;
          console.log(`Updated ${stock.symbol} with name: ${companyName}`);
        } else {
          stock.companyName = stock.originalSymbol || stock.symbol;
          console.log(
            `No name found for ${stock.symbol}, using symbol as fallback`
          );
        }
        // Add small delay to avoid hitting API limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );

    res.json({ message: "Company names updated successfully" });
  } catch (error) {
    console.error("Error updating company names:", error);
    res.status(500).json({ error: "Failed to update company names" });
  }
});

app.listen(PORT, () => {
  console.log(`Investment Tracker Server running at http://localhost:${PORT}`);
  console.log("Manual refresh available via UI - Auto-refresh disabled");
});

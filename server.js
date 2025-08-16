const express = require("express");
const cors = require("cors");
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Helper function to safely convert to number and handle NaN
function safeNumber(value, defaultValue = 0) {
  const num = parseFloat(value);
  return isNaN(num) ? defaultValue : num;
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

app.post("/api/portfolio/stock", async (req, res) => {
  try {
    const { symbol, quantity, purchasePrice, purchaseDate } = req.body;

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    const newStock = {
      id: Date.now().toString(),
      symbol: symbol.toUpperCase(),
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

    portfolio.stocks.push(newStock);

    await fs.writeFile(
      path.join(__dirname, "data", "portfolio.json"),
      JSON.stringify(portfolio, null, 2)
    );
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

    const data = await fs.readFile(
      path.join(__dirname, "data", "portfolio.json"),
      "utf8"
    );
    const portfolio = JSON.parse(data);

    const newMF = {
      id: Date.now().toString(),
      scheme,
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
          // Use Yahoo Finance API for Indian stocks
          const response = await axios.get(
            `https://query1.finance.yahoo.com/v8/finance/chart/${stock.symbol}.NS`,
            {
              timeout: 5000,
            }
          );

          if (
            response.data &&
            response.data.chart &&
            response.data.chart.result &&
            response.data.chart.result[0]
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
              console.log(`Updated ${stock.symbol}: ₹${stock.currentPrice}`);
            } else {
              console.log(`No valid price data for ${stock.symbol}`);
              stock.priceError = true;
            }
          } else {
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
          // For now, we'll need to use a mapping of scheme names to codes
          // In a production app, you'd maintain this mapping in a database
          const schemeMapping = {
            "Nippon India Small Cap Fund Direct Growth": "120716",
          };

          const schemeCode = schemeMapping[mf.scheme];

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
            console.log(`No scheme code mapping available for ${mf.scheme}`);
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

app.listen(PORT, () => {
  console.log(`Investment Tracker Server running at http://localhost:${PORT}`);
  console.log("Manual refresh available via UI - Auto-refresh disabled");
});

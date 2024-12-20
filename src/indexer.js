import fs from "fs";
import path from "path";
import { createPublicClient, http, parseAbi } from "viem";

const NETWORKS = [
  {
    name: "ethereum",
    rpcs: [
      "https://eth-mainnet.g.alchemy.com/v2/K4l0nBr5UE4e8Kkr9oETClKtKcW9DJYT",
      "https://cosmological-blissful-research.quiknode.pro/223e82a51a5bd046eb64dea56744b813038d2495",
      "https://mainnet.infura.io/v3/273aad656cd94f9aa022e4899b87dd6c",
      "https://eth-mainnet.g.alchemy.com/v2/OwAiuhcEzUbycbvve7flzDzAb39nyYA-",
      "https://eth-mainnet.g.alchemy.com/v2/2SAHh1Jw8BIHHI9NT3Z1qYfT8HcSo9b5",
      "https://ethereum-mainnet.core.chainstack.com/fe2d2bc46bdaf3716bcb64bd9351e01b",
    ],
    chainId: 1,
    fromBlock: 21441366n,
  },
  {
    name: "polygon",
    rpcs: [
      "https://polygon-mainnet.g.alchemy.com/v2/sTJtjdOBExGkT4lWuS-wt5VduGCQsqwf",
      "https://snowy-polished-daylight.matic.quiknode.pro/466e77c6325e477c76712cb478e6cd09ce1cc7a2",
      "https://polygon-mainnet.infura.io/v3/273aad656cd94f9aa022e4899b87dd6c",
      "https://polygon-mainnet.g.alchemy.com/v2/-CukmxMwnzkgtKbWDIqvJ5Oi8uvdxUlg",
      "https://polygon-mainnet.g.alchemy.com/v2/NG4jyJ0QEr410TuliKgmZIYjwN5y2eyL",
      "https://polygon-mainnet.core.chainstack.com/275d1e0ae21da1e6aa7a21e9962e4ca5",
    ],
    chainId: 137,
    fromBlock: 65699241n,
  },
  // {
  //   name: "anvil",
  //   chain: foundry,
  //   address: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  //   rpcs: [undefined],
  //   chainId: 31337,
  //   fromBlock: 1n,
  // },
];

const ABI = parseAbi([
  "event BlockHeaderRequested(address indexed contractAddress, uint256 indexed blockNumber, uint256 indexed headerIndex, uint256 rewardAmount)",
  "event BlockHeaderResponded(address indexed contractAddress, uint256 indexed blockNumber, uint256 headerIndex, address indexed responder)",
  "event BlockHeaderCommitted(uint256 indexed blockNumber)",
  "event BlockHeaderRefunded(uint256 indexed blockNumber, uint256 indexed headerIndex)",
]);

const DATA_DIR = "./data";
const MAX_BLOCK_RANGE = 800; // Maximum block range allowed per request

// Helper Functions
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const stringifyWithBigInt = (data) =>
  JSON.stringify(
    data,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2
  );

const parseWithBigInt = (data) =>
  JSON.parse(data, (_, value) => (/^\d+$/.test(value) ? BigInt(value) : value));

const saveTrackerFile = (filepath, data) => {
  fs.writeFileSync(filepath, stringifyWithBigInt(data));
};

const loadTrackerFile = (filepath) => {
  try {
    return parseWithBigInt(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
  }
};

const loadJsonFile = (filepath) => {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return [];
  }
};

const saveJsonFile = (filepath, data) => {
  fs.writeFileSync(
    filepath,
    JSON.stringify(
      data,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    )
  );
};

const splitBlockRanges = (fromBlock, toBlock, maxRange) => {
  const ranges = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + BigInt(maxRange) - 1n;
    ranges.push({ fromBlock: start, toBlock: end > toBlock ? toBlock : end });
    start = end + 1n;
  }
  return ranges;
};

const createRpcClient = (chain, rpcs) => {
  let currentIndex = 0;
  return {
    getNextRpc: () => {
      const rpc = rpcs[currentIndex];
      currentIndex = (currentIndex + 1) % rpcs.length;
      return rpc;
    },
    createClient: (rpc) => createPublicClient({ chain, transport: http(rpc) }),
  };
};

const fetchWithRetries = async (
  fetchFn,
  rpcManager,
  maxRetries = 5,
  delay = 1000
) => {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      return await fetchFn();
    } catch (error) {
      if (error.status === 429) {
        attempts++;
        const newRpc = rpcManager.getNextRpc();
        console.log(`Rate limit hit. Switching to next RPC: ${newRpc}`);
        rpcManager.client = rpcManager.createClient(newRpc);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
  throw new Error("Exceeded maximum retries across all RPCs.");
};

const fetchLogsInRange = async (
  client,
  address,
  fromBlock,
  toBlock,
  events
) => {
  const ranges = splitBlockRanges(fromBlock, toBlock, MAX_BLOCK_RANGE);
  const logs = [];
  for (const range of ranges) {
    const rangeLogs = await client.getLogs({
      address,
      events,
      fromBlock: range.fromBlock,
      toBlock: range.toBlock,
    });
    logs.push(...rangeLogs);
  }
  return logs;
};

/**
 * Merge logic for daily events (raw logs into structured events):
 * - Key by "blockNumber-headerIndex" for requests/responses/refunds and "blockNumber-committed" for commit-only.
 * - If a commit-only entry is present and no other events share that blockNumber, keep it as commit-only.
 * - If another event for that blockNumber appears later, merge the commit fields in and remove the commit-only entry.
 */
const mergeEvents = (existingData, newEvents) => {
  const eventMap = new Map();

  // Load existing data
  for (const evt of existingData) {
    const key =
      evt.headerIndex !== undefined
        ? `${evt.blockNumber}-${evt.headerIndex}`
        : `${evt.blockNumber}-committed`;
    eventMap.set(key, evt);
  }

  const getKey = (ev) => {
    if (ev.eventType === "committed") return `${ev.argsBlockNumber}-committed`;
    if (ev.headerIndex !== undefined)
      return `${ev.argsBlockNumber}-${ev.headerIndex}`;
    return `${ev.argsBlockNumber}-committed`;
  };

  for (const event of newEvents) {
    const key = getKey(event);
    const existing = eventMap.get(key) || {};

    if (!existing.responses) existing.responses = [];

    existing.chainId = event.chainId;
    existing.createdAt = existing.createdAt || event.createdAt;
    existing.updatedAt = new Date().toISOString();
    existing.blockNumber = event.argsBlockNumber;
    if (event.headerIndex !== undefined)
      existing.headerIndex = event.headerIndex;

    switch (event.eventType) {
      case "request":
        existing.request = {
          contractAddress: event.requestedContractAddress,
          blockNumber: event.requestedEventBlockNumber,
          transactionHash: event.requestedTransactionHash,
          blockHash: event.requestedBlockHash,
        };
        break;

      case "response":
        if (
          !existing.responses.some(
            (r) => r.transactionHash === event.respondedTransactionHash
          )
        ) {
          existing.responses.push({
            contractAddress: event.responseContractAddress,
            responder: event.responder,
            blockNumber: event.respondedEventBlockNumber,
            transactionHash: event.respondedTransactionHash,
            blockHash: event.respondedBlockHash,
          });
        }
        break;

      case "committed":
        existing.commit = {
          blockNumber: event.committedEventBlockNumber,
          transactionHash: event.committedTransactionHash,
          blockHash: event.committedBlockHash,
        };
        break;

      case "refunded":
        existing.refund = {
          blockNumber: event.refundedEventBlockNumber,
          transactionHash: event.refundedTransactionHash,
          blockHash: event.refundedBlockHash,
        };
        break;
    }

    eventMap.set(key, existing);
  }

  // Post-processing for daily merges: merge committed events if possible
  const finalMap = new Map(eventMap);
  for (const [key, value] of eventMap.entries()) {
    if (key.endsWith("-committed") && value.commit) {
      const blockNumber = key.replace("-committed", "");
      let merged = false;
      for (const [innerKey, innerValue] of eventMap.entries()) {
        if (innerKey !== key && innerKey.startsWith(`${blockNumber}-`)) {
          innerValue.commit = { ...value.commit };
          innerValue.updatedAt = new Date().toISOString();
          merged = true;
        }
      }
      if (merged) {
        finalMap.delete(key);
      }
    }
  }

  for (const val of finalMap.values()) {
    if (val.responses && val.responses.length === 0) {
      delete val.responses;
    }
  }

  return Array.from(finalMap.values());
};

/**
 * Merge logic for monthly events:
 * Here, we are merging already structured daily events (not raw logs).
 * The structure is final, so we just need to unify any duplicates.
 * - Key events similarly by "blockNumber-headerIndex" or "blockNumber-committed".
 * - If the same event appears multiple times, merge fields:
 *   - Merge `request`, `commit`, `refund` if they don't exist.
 *   - Combine `responses` arrays without duplicates.
 * - Retain commit-only entries if no related events are found.
 */
const mergeMonthlyEvents = (existingData, newData) => {
  const eventMap = new Map();

  const getMonthlyKey = (evt) => {
    if (evt.headerIndex !== undefined)
      return `${evt.blockNumber}-${evt.headerIndex}`;
    return `${evt.blockNumber}-committed`;
  };

  const mergeResponseArrays = (arr1 = [], arr2 = []) => {
    const seenTx = new Set(arr1.map((r) => r.transactionHash));
    for (const resp of arr2) {
      if (!seenTx.has(resp.transactionHash)) {
        arr1.push(resp);
      }
    }
    return arr1;
  };

  const mergeEventObjects = (target, source) => {
    // Merge request
    if (source.request && !target.request)
      target.request = { ...source.request };
    // Merge commit
    if (source.commit && !target.commit) target.commit = { ...source.commit };
    // Merge refund
    if (source.refund && !target.refund) target.refund = { ...source.refund };
    // Merge responses
    if (source.responses) {
      target.responses = mergeResponseArrays(
        target.responses,
        source.responses
      );
    }
  };

  // Insert existing events first
  for (const evt of existingData) {
    const key = getMonthlyKey(evt);
    eventMap.set(key, { ...evt });
  }

  // Merge new data
  for (const evt of newData) {
    const key = getMonthlyKey(evt);
    if (!eventMap.has(key)) {
      eventMap.set(key, { ...evt });
    } else {
      const existing = eventMap.get(key);
      // Merge all relevant fields
      mergeEventObjects(existing, evt);

      // Update timestamps
      // Keep earliest createdAt, update updatedAt to now
      if (new Date(evt.createdAt) < new Date(existing.createdAt)) {
        existing.createdAt = evt.createdAt;
      }
      existing.updatedAt = new Date().toISOString();
    }
  }

  return Array.from(eventMap.values());
};

// Rebuild monthly file using `mergeMonthlyEvents`
const rebuildMonthlyFile = (networkDir, yearMonth) => {
  const files = fs
    .readdirSync(networkDir)
    .filter(
      (f) =>
        f.startsWith(yearMonth) &&
        f.endsWith(".json") &&
        f.match(/^\d{4}-\d{2}-\d{2}\.json$/)
    );

  let allEvents = [];
  for (const file of files) {
    const dailyData = loadJsonFile(path.join(networkDir, file));
    // Monthly merge deals with fully structured daily data
    allEvents = mergeMonthlyEvents(allEvents, dailyData);
  }

  const monthlyFilePath = path.join(networkDir, `${yearMonth}.json`);
  saveJsonFile(monthlyFilePath, allEvents);
  console.log(
    `Rebuilt monthly file: ${yearMonth}.json with ${allEvents.length} events`
  );
};

(async () => {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const thisYearMonth = today.slice(0, 7); // YYYY-MM

  for (const {
    name,
    chain,
    address,
    rpcs,
    chainId,
    fromBlock: defaultFromBlock,
  } of NETWORKS) {
    console.log(`\n\n------------ Processing chain: ${name} ------------`);

    const rpcManager = createRpcClient(chain, rpcs);
    rpcManager.client = rpcManager.createClient(rpcManager.getNextRpc());

    const networkDir = path.join(DATA_DIR, name);
    ensureDirExists(networkDir);

    const blockRangesFile = path.join(networkDir, "block_ranges.json");
    const lastBlocksFile = path.join(DATA_DIR, "last_blocks.json");

    const lastBlocks = loadTrackerFile(lastBlocksFile);
    const blockRanges = loadTrackerFile(blockRangesFile);

    const fromBlock = BigInt(lastBlocks[name]?.fromBlock || defaultFromBlock);
    const latestBlock = await fetchWithRetries(
      () => rpcManager.client.getBlockNumber(),
      rpcManager
    );
    const toBlock = latestBlock;

    console.log(`Fetching logs from block ${fromBlock} to ${toBlock}...`);
    const logs = await fetchWithRetries(
      () =>
        fetchLogsInRange(rpcManager.client, address, fromBlock, toBlock, ABI),
      rpcManager
    );
    console.log(`Fetched ${logs.length} total logs.`);

    const categorizedEvents = logs
      .map((log) => {
        const { eventName, args } = log;
        if (!eventName || !args) return null;

        const baseEvent = {
          chainId: chainId.toString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        switch (eventName) {
          case "BlockHeaderRequested":
            return {
              ...baseEvent,
              eventType: "request",
              argsBlockNumber: args.blockNumber.toString(),
              headerIndex: args.headerIndex.toString(),
              requestedContractAddress: args.contractAddress,
              requestedEventBlockNumber: log.blockNumber.toString(),
              requestedTransactionHash: log.transactionHash,
              requestedBlockHash: log.blockHash,
            };

          case "BlockHeaderResponded":
            return {
              ...baseEvent,
              eventType: "response",
              argsBlockNumber: args.blockNumber.toString(),
              headerIndex: args.headerIndex.toString(),
              responseContractAddress: args.contractAddress,
              responder: args.responder,
              respondedEventBlockNumber: log.blockNumber.toString(),
              respondedTransactionHash: log.transactionHash,
              respondedBlockHash: log.blockHash,
            };

          case "BlockHeaderCommitted":
            return {
              ...baseEvent,
              eventType: "committed",
              argsBlockNumber: args.blockNumber.toString(),
              committedEventBlockNumber: log.blockNumber.toString(),
              committedTransactionHash: log.transactionHash,
              committedBlockHash: log.blockHash,
            };

          case "BlockHeaderRefunded":
            return {
              ...baseEvent,
              eventType: "refunded",
              argsBlockNumber: args.blockNumber.toString(),
              headerIndex: args.headerIndex.toString(),
              refundedEventBlockNumber: log.blockNumber.toString(),
              refundedTransactionHash: log.transactionHash,
              refundedBlockHash: log.blockHash,
            };

          default:
            return null;
        }
      })
      .filter(Boolean);

    // Merge with existing daily file
    const dailyFile = path.join(networkDir, `${today}.json`);
    const dailyData = loadJsonFile(dailyFile);
    const mergedData = mergeEvents(dailyData, categorizedEvents);

    console.log(`Saving ${mergedData.length} events to ${dailyFile}`);
    saveJsonFile(dailyFile, mergedData);

    // Update block range tracker
    if (!blockRanges[today]) {
      blockRanges[today] = {
        startBlock: fromBlock.toString(),
        endBlock: toBlock.toString(),
      };
    } else {
      blockRanges[today].endBlock = toBlock.toString();
    }

    console.log(`Updating block ranges: ${fromBlock} - ${toBlock}`);
    saveTrackerFile(blockRangesFile, blockRanges);

    lastBlocks[name] = { fromBlock: (toBlock + 1n).toString() };
    console.log(`Updating last processed block to ${toBlock + 1n}`);
    saveTrackerFile(lastBlocksFile, lastBlocks);

    // Rebuild monthly file using the separate monthly merge
    rebuildMonthlyFile(networkDir, thisYearMonth);

    console.log(`Finished processing chain: ${name}`);
  }
})();

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
const MAX_BLOCK_RANGE = 800;

const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const loadJsonFile = (filepath) => {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return [];
  }
};

const loadJsonObject = (filepath) => {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8"));
  } catch {
    return {};
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
        delay *= 2;
      } else {
        throw error;
      }
    }
  }
  throw new Error("Exceeded maximum retries.");
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

// After updating entries in a block file, ensure commit logic:
// If there's a commit-only entry and other entries exist, copy commit to all and remove commit-only entry.
// If commit appears and other entries exist, ensure each has commit.
const normalizeCommitLogic = (data) => {
  const commitOnlyIndex = data.findIndex(
    (d) => d.commit && !d.headerIndex && !d.request && !d.responses && !d.refund
  );
  const hasCommitOnly = commitOnlyIndex !== -1;
  const commitOnlyEntry = hasCommitOnly ? data[commitOnlyIndex] : null;

  // Count how many entries have events besides commit-only
  const eventEntries = data.filter(
    (d) => d.headerIndex !== undefined || d.request || d.responses || d.refund
  );

  if (hasCommitOnly && eventEntries.length > 0) {
    // Move commit into all event entries
    for (const evt of eventEntries) {
      evt.commit = { ...commitOnlyEntry.commit };
      evt.updatedAt = new Date().toISOString();
    }
    // Remove commit-only entry
    data.splice(commitOnlyIndex, 1);
  } else if (!hasCommitOnly && eventEntries.some((e) => e.commit)) {
    // If commit arrives after other events are created,
    // ensure that commit is present in all entries that lack it.
    let commitData = null;
    for (const evt of data) {
      if (evt.commit) {
        commitData = evt.commit;
        break;
      }
    }
    if (commitData) {
      for (const evt of data) {
        if (!evt.commit) {
          evt.commit = { ...commitData };
          evt.updatedAt = new Date().toISOString();
        }
      }
    }
  }

  return data;
};

const updateBlockFile = (blockFilePath, eventObj) => {
  let data = loadJsonFile(blockFilePath);
  let entryIndex = -1;
  if (eventObj.headerIndex !== undefined) {
    entryIndex = data.findIndex((d) => d.headerIndex === eventObj.headerIndex);
  } else {
    // For commit-only or if no headerIndex, find commit-only entry
    if (eventObj.eventType === "committed") {
      // commit-only scenario
      entryIndex = data.findIndex((d) => d.commit && !d.headerIndex);
    } else {
      // If no headerIndex for other events is unusual, but handled anyway
      entryIndex = data.findIndex(
        (d) =>
          d.headerIndex === undefined && !d.request && !d.responses && !d.refund
      );
    }
  }

  let entry = entryIndex > -1 ? data[entryIndex] : null;

  if (!entry) {
    entry = {
      chainId: eventObj.chainId,
      blockNumber: eventObj.argsBlockNumber,
      headerIndex: eventObj.headerIndex,
      createdAt: eventObj.createdAt,
      updatedAt: eventObj.updatedAt,
    };
    data.push(entry);
    entryIndex = data.length - 1;
  } else {
    entry.updatedAt = new Date().toISOString();
  }

  switch (eventObj.eventType) {
    case "request":
      entry.request = {
        rewardAmount: eventObj.requestedRewardAmount,
        contractAddress: eventObj.requestedContractAddress,
        blockNumber: eventObj.requestedEventBlockNumber,
        transactionHash: eventObj.requestedTransactionHash,
        blockHash: eventObj.requestedBlockHash,
      };
      break;

    case "response":
      if (!entry.responses) entry.responses = [];
      if (
        !entry.responses.some(
          (r) => r.transactionHash === eventObj.respondedTransactionHash
        )
      ) {
        entry.responses.push({
          contractAddress: eventObj.responseContractAddress,
          responder: eventObj.responder,
          blockNumber: eventObj.respondedEventBlockNumber,
          transactionHash: eventObj.respondedTransactionHash,
          blockHash: eventObj.respondedBlockHash,
        });
      }
      break;

    case "committed":
      entry.commit = {
        blockNumber: eventObj.committedEventBlockNumber,
        transactionHash: eventObj.committedTransactionHash,
        blockHash: eventObj.committedBlockHash,
      };
      break;

    case "refunded":
      entry.refund = {
        blockNumber: eventObj.refundedEventBlockNumber,
        transactionHash: eventObj.refundedTransactionHash,
        blockHash: eventObj.refundedBlockHash,
      };
      break;
  }

  data[entryIndex] = entry;
  data = normalizeCommitLogic(data);
  saveJsonFile(blockFilePath, data);
};

const rebuildDailyIndex = (dayDir) => {
  const files = fs
    .readdirSync(dayDir)
    .filter((f) => f.endsWith(".json") && f !== "index.json");
  let allEvents = [];
  for (const file of files) {
    const eventData = loadJsonFile(path.join(dayDir, file));
    allEvents = allEvents.concat(eventData);
  }
  saveJsonFile(path.join(dayDir, "index.json"), allEvents);
};

const rebuildMonthlyIndex = (monthDir) => {
  const days = fs.readdirSync(monthDir).filter((d) => /^\d{2}$/.test(d));
  let allEvents = [];
  for (const day of days) {
    const dayIndexPath = path.join(monthDir, day, "index.json");
    if (fs.existsSync(dayIndexPath)) {
      const dayEvents = loadJsonFile(dayIndexPath);
      allEvents = allEvents.concat(dayEvents);
    }
  }
  saveJsonFile(path.join(monthDir, "index.json"), allEvents);
};

const rebuildYearlyIndex = (yearDir) => {
  const months = fs.readdirSync(yearDir).filter((m) => /^\d{2}$/.test(m));
  let allEvents = [];
  for (const month of months) {
    const monthIndexPath = path.join(yearDir, month, "index.json");
    if (fs.existsSync(monthIndexPath)) {
      const monthEvents = loadJsonFile(monthIndexPath);
      allEvents = allEvents.concat(monthEvents);
    }
  }
  saveJsonFile(path.join(yearDir, "index.json"), allEvents);
};

(async () => {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const [year, month, day] = today.split("/")[0].includes("-")
    ? today.split("-")
    : today.split("/");
  const datePath = `${year}/${month}/${day}`;

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

    const mapFile = path.join(networkDir, "map.json");
    let mapData = loadJsonObject(mapFile);

    const historyFile = path.join(networkDir, "history.json");
    let historyData = loadJsonObject(historyFile);
    if (!historyData.updates) {
      historyData.updates = [];
    }

    const lastBlocksFile = path.join(DATA_DIR, "last_blocks.json");
    let lastBlocks = {};
    try {
      lastBlocks = JSON.parse(fs.readFileSync(lastBlocksFile, "utf8"));
    } catch {
      lastBlocks = {};
    }

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
              requestedRewardAmount: args.rewardAmount.toString(),
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

    if (categorizedEvents.length === 0) {
      console.log("No new events.");
      lastBlocks[name] = { fromBlock: (toBlock + 1n).toString() };
      fs.writeFileSync(lastBlocksFile, JSON.stringify(lastBlocks, null, 2));
      continue;
    }

    // Ensure directories for year/month/day
    const yearDir = path.join(networkDir, year);
    const monthDir = path.join(yearDir, month);
    const dayDir = path.join(monthDir, day);
    ensureDirExists(yearDir);
    ensureDirExists(monthDir);
    ensureDirExists(dayDir);

    const updatedBlockNumbers = new Set();

    // Process each event
    for (const eventObj of categorizedEvents) {
      const argsBlockNumber = eventObj.argsBlockNumber;

      // Check map for existing entry
      let mappedDate = mapData[argsBlockNumber];
      if (!mappedDate) {
        // New block number, map it to today's date
        const datePathLocal = `${year}/${month}/${day}`;
        mapData[argsBlockNumber] = datePathLocal;
        mappedDate = datePathLocal;
      }

      const [y, mm, dd] = mappedDate.split("/");
      const blockDir = path.join(networkDir, y, mm, dd);
      ensureDirExists(blockDir);

      const blockFile = path.join(blockDir, `${argsBlockNumber}.json`);
      if (!fs.existsSync(blockFile)) {
        saveJsonFile(blockFile, []);
      }

      updateBlockFile(blockFile, eventObj);
      updatedBlockNumbers.add(argsBlockNumber);
    }

    // Update map.json
    saveJsonFile(mapFile, mapData);

    // Update history.json: append a new update record
    historyData.updates.push({
      timestamp: new Date().toISOString(),
      updatedBlockNumbers: [...updatedBlockNumbers],
    });
    saveJsonFile(historyFile, historyData);

    // Update last processed block
    lastBlocks[name] = { fromBlock: (toBlock + 1n).toString() };
    fs.writeFileSync(lastBlocksFile, JSON.stringify(lastBlocks, null, 2));

    // Rebuild indexes
    rebuildDailyIndex(dayDir);
    rebuildMonthlyIndex(monthDir);
    rebuildYearlyIndex(yearDir);

    console.log(`Finished processing chain: ${name}`);
  }
})();

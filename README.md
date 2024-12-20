# HeaderProtocol: Event Indexer Service

<div style="text-align:center" align="center">
    <img src="https://raw.githubusercontent.com/headerprotocol/headerprotocol/master/logo.png" width="200">
</div>

---

**Table of Contents**

- [Overview](#overview)
- [Events Processed](#events-processed)
- [Data Structure](#data-structure)
- [Workflow](#workflow)
- [File Layout](#file-layout)
- [Key Features](#key-features)
- [Configuration](#configuration)
- [Running the Indexer](#running-the-indexer)

---

## Overview

The HeaderProtocol Event Indexer is a Node.js service that continuously fetches, decodes, and aggregates blockchain events from EVM-compatible networks. It normalizes various event types related to block headers (requests, responses, commits, refunds) into a structured JSON format.

This service supports daily and monthly data aggregation, ensuring that you always have a coherent snapshot of on-chain activity.

---

## Events Processed

The indexer fetches and merges the following events:

- **BlockHeaderRequested (blockNumber + headerIndex)**:  
  A request for a specific block header.
- **BlockHeaderResponded (blockNumber + headerIndex)**:  
  A response to a previously requested header.
- **BlockHeaderCommitted (blockNumber)**:  
  Indicates that the requested block header data is fully committed.
- **BlockHeaderRefunded (blockNumber + headerIndex)**:  
  A refund event for incomplete or invalid requests.

These events are combined into a single, unified data structure per `(blockNumber, headerIndex)` pair, with `BlockHeaderCommitted` events keyed by `blockNumber` only.

---

## Data Structure

**Top-level keys:**

- `blockNumber`: String representing the requested block number.
- `headerIndex`: String representing the header index within the requested block.
- `request`: Contains details of the request event:
  ```json
  "request": {
    "contractAddress": "...",
    "blockNumber": "...",
    "transactionHash": "...",
    "blockHash": "..."
  }
  ```
- `responses`: An array of objects representing responses:
  ```json
  "responses": [
    {
      "contractAddress": "...",
      "responder": "...",
      "blockNumber": "...",
      "transactionHash": "...",
      "blockHash": "..."
    }
  ]
  ```
- `commit`: Contains details of the commit event:
  ```json
  "commit": {
    "blockNumber": "...",
    "transactionHash": "...",
    "blockHash": "..."
  }
  ```
- `refund`: Contains details of the refund event:
  ```json
  "refund": {
    "blockNumber": "...",
    "transactionHash": "...",
    "blockHash": "..."
  }
  ```

**Metadata Fields:**

- `chainId`: String representing the blockchain's chain ID.
- `createdAt`, `updatedAt`: ISO timestamps indicating when the record was created and last updated.

**Example of a fully populated record:**

```json
{
  "chainId": "31337",
  "blockNumber": "1000",
  "headerIndex": "15",
  "request": {
    "contractAddress": "0x5FbDB2315678afecb367...",
    "blockNumber": "500",
    "transactionHash": "0xd578aca20714567281b7d...",
    "blockHash": "0x8aad50287ac6ff773ccd5..."
  },
  "responses": [
    {
      "contractAddress": "0xe7f1725E7734CE288F83...",
      "responder": "0xf39Fd6e51aad88F6F4ce6a...",
      "blockNumber": "501",
      "transactionHash": "0x9d3b3ff38e5434e4d98f2a...",
      "blockHash": "0x27298713dc3523d93bcddd..."
    }
  ],
  "commit": {
    "blockNumber": "502",
    "transactionHash": "0xc39d36a7cb300658b1c0bd9dc9...",
    "blockHash": "0xbcbb234c25ff71e986d3dd..."
  },
  "refund": {
    "blockNumber": "503",
    "transactionHash": "0xf2a2b98639f41f9e06d5...",
    "blockHash": "0xc6e904d8cfd5648108d0041..."
  },
  "createdAt": "2024-12-20T12:00:00Z",
  "updatedAt": "2024-12-20T12:10:00Z"
}
```

Not all sections are always present. For example, if no responses were made, `responses` is omitted. If the header was never refunded, `refund` remains absent.

---

## Workflow

1. **Initialization**:  
   Reads `last_blocks.json` to determine the last processed block for each network and `block_ranges.json` for daily ranges.

2. **Fetching Events**:  
   Uses `viem` to decode and fetch events in efficient block ranges.

3. **Daily Aggregation**:

   - Raw events are categorized and merged using `mergeEvents`.
   - Writes out `YYYY-MM-DD.json` files, each representing a day's worth of activity.

4. **Monthly Aggregation**:

   - After updating daily files, the indexer merges all daily files for the month using `mergeMonthlyEvents`.
   - Produces a `YYYY-MM.json` file that aggregates all daily data into a single snapshot for that month.

5. **Update Tracking**:
   - `last_blocks.json` and `block_ranges.json` updated to reflect new progress.
   - Next run starts from the last processed block.

---

## File Layout

```
data/
└── <network-name>/
    ├── 2024-12-20.json          # Daily events for Dec 20, 2024
    ├── 2024-12-21.json          # Daily events for Dec 21, 2024
    ├── 2024-12.json             # Monthly aggregated file for Dec 2024
    ├── block_ranges.json        # Tracks the block ranges processed each day
last_blocks.json                 # Tracks the last processed block for each network
```

---

## Key Features

- **Single Query for All Events**:  
  Aggregates multiple events via a single `getLogs` call to reduce overhead.

- **Robust Merging Logic**:

  - Daily merges convert raw logs into structured events.
  - Monthly merges unify multiple daily files into a comprehensive monthly dataset.

- **Commit-Only Event Support**:  
  Standalone commit events remain even if no related request/response/refund events exist yet. Once such events appear, commit data merges seamlessly.

- **Data Consistency & Scalability**:
  - Handles large block ranges by splitting queries.
  - Ensures consistent JSON structure suitable for analysis or indexing.

---

## Configuration

- `NETWORKS`: An array of configured chains, each specifying `name`, `chainId`, `address`, RPC endpoints, and the `fromBlock` to start indexing.

- `MAX_BLOCK_RANGE`: Maximum block chunk size to prevent RPC overload.

- `DATA_DIR`: The base directory for storing JSON files.

---

## Running the Indexer

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Run Anvil**:

   ```bash
   anvil
   ```

3. **Deploy** [headerprotocol](https://github.com/headerprotocol/headerprotocol):

   ```bash
   sudo bash ./script/anvil_events.sh
   ```

4. **Run the Indexer**:

   ```bash
   node src/indexer.js
   ```

   The indexer fetches new events, merges them into daily files, and reconstructs the monthly file.

5. **Check Outputs**:  
   Inspect `data/<network>/YYYY-MM-DD.json` and `data/<network>/YYYY-MM.json`.

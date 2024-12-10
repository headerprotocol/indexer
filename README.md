# HeaderProtocol Indexer

The **HeaderProtocol Indexer** is a robust blockchain indexing solution designed to track `BlockHeaderRequested` and `BlockHeaderResponded` events across multiple EVM-compatible blockchains. The indexer processes blockchain logs, organizes data into network-specific files, and ensures consistency and compatibility across chains.

---

## Features

### Multi-Chain Compatibility

The indexer works seamlessly with any EVM-compatible blockchain. Simply configure the network details, and the indexer will adapt to handle its logs and block structure.

### Event Tracking

Tracks two key events:

1. **BlockHeaderRequested**: Logs details of block header requests.
2. **BlockHeaderResponded**: Logs responses to block header requests.

Each event is processed and combined to provide a clear mapping between requests and responses.

### Consistent Data Storage

Data is stored in JSON files organized by:

- **Network-Specific Folders**: Each network has its own directory for event logs and block range tracking.
- **Daily Files**: Events are stored in files named by date (`YYYY-MM-DD.json`).
- **Block Range Files**: Tracks the block range processed for each day (`block_ranges.json`).
- **Global Tracker**: Maintains the last processed block for each network (`last_blocks.json`).

### Deduplication and Delayed Event Handling

Events are deduplicated using a unique key (`blockNumber + headerIndex`). The indexer also ensures delayed responses are correctly linked to their requests, even if processed days apart.

### Consistent Block Number Storage

Block numbers (`startBlock` and `endBlock`) are stored as strings across all chains to ensure compatibility and prevent inconsistencies.

### Block Range Management

Handles block range limitations for RPC providers by splitting large ranges into smaller chunks, ensuring reliable and efficient log retrieval.

### Detailed Logs

The indexer provides detailed logs during execution, including:

- Chains being processed.
- Block ranges being fetched.
- Number of logs fetched for each event type.
- Number of events saved to daily files.
- Updated block ranges and last processed blocks.

---

## Data Structure

### **Daily Event Files**

Events are stored as an array of JSON objects in `YYYY-MM-DD.json` files. Each object contains:

```json
[
  {
    "chainId": "1",
    "contractAddress": "0x...",
    "responder": "0x...",
    "blockNumber": "123456",
    "headerIndex": "1",
    "feeAmount": "1000000000",
    "requestedBlockNumber": "123450",
    "requestedTransactionHash": "0x...",
    "requestedBlockHash": "0x...",
    "respondedBlockNumber": "123460",
    "respondedTransactionHash": "0x...",
    "respondedBlockHash": "0x...",
    "createdAt": "2024-12-10T12:00:00Z",
    "updatedAt": "2024-12-10T12:05:00Z"
  }
]
```

### **Block Range Files**

Tracks block ranges processed for each day in `block_ranges.json`:

```json
{
  "2024-12-10": {
    "startBlock": "21368974",
    "endBlock": "21368994"
  }
}
```

### **Global Block Tracker**

Tracks the last processed block for each network in `last_blocks.json`:

```json
{
  "networkName": {
    "fromBlock": "21368995"
  }
}
```

---

## Improvements

### Block Range Splitting

- Handles RPC limitations by splitting large block ranges into smaller chunks, ensuring compatibility with providers that enforce range limits.

### Consistent Block Number Handling

- Standardizes block numbers as strings across all files and networks.

### Logging Enhancements

- Provides detailed logs for better visibility during execution:
  - Chain being processed.
  - Fetched block ranges.
  - Number of logs fetched for each event type.
  - Saved events and updated ranges.

### Multi-Network Support

- Works with all EVM-compatible chains, adapting to their configurations.

### Improved Initialization

- Automatically initializes from a specified `fromBlock` parameter for each network if tracking files (`last_blocks.json` and `block_ranges.json`) are missing or empty.

---

## Benefits

1. **Reliability**: Handles large-scale log retrieval while respecting RPC provider limitations.
2. **Flexibility**: Easily configurable to support any EVM-compatible blockchain.
3. **Efficiency**: Deduplicates and organizes data for easy access and analysis.
4. **Scalability**: Designed to scale with growing blockchain activity.
5. **Transparency**: Logs every step, providing insights into indexing progress.

---

## Directory Structure

The directory structure for stored data is as follows:

```
data/
├── networkName/
│   ├── YYYY-MM-DD.json      # Daily event files
│   ├── block_ranges.json    # Daily block range tracker
├── last_blocks.json         # Global tracker for last processed blocks
```

---

This indexer provides a solid foundation for tracking and analyzing blockchain events across multiple EVM-compatible networks. Its robust features ensure consistency, reliability, and efficiency in processing blockchain data.

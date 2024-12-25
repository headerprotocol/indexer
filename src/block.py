import sys
import rlp # pip install rlp hexbytes eth_hash web3
from hexbytes import HexBytes
from eth_hash.auto import keccak
from web3 import Web3

# Connect to local Anvil blockchain
anvil_url = "http://127.0.0.1:8545"  # Replace with your Anvil URL if different
web3 = Web3(Web3.HTTPProvider(anvil_url))

if not web3.is_connected():
    print("Failed to connect to Anvil")
    exit()

# Fetch block X data
block_number = int(sys.argv[1])
block = web3.eth.get_block(block_number)

# Extract block header fields
block_header = [
    HexBytes(block["parentHash"]),           # parentHash
    HexBytes(block["sha3Uncles"]),           # sha3Uncles
    HexBytes(block["miner"]),                # miner
    HexBytes(block["stateRoot"]),            # stateRoot
    HexBytes(block["transactionsRoot"]),     # transactionsRoot
    HexBytes(block["receiptsRoot"]),         # receiptsRoot
    HexBytes(block["logsBloom"]),            # logsBloom
    block["difficulty"],                     # difficulty
    block["number"],                         # number
    block["gasLimit"],                       # gasLimit
    block["gasUsed"],                        # gasUsed
    block["timestamp"],                      # timestamp
    HexBytes(block["extraData"]),            # extraData
    HexBytes(block["mixHash"]),              # mixHash
    HexBytes(block["nonce"]),                # nonce
    block.get("baseFeePerGas", 0),           # baseFeePerGas (default to 0 if not present)
    HexBytes(block.get("withdrawalsRoot", b"0x")),  # withdrawalsRoot (default to empty)
    block.get("blobGasUsed", 0),             # blobGasUsed (default to 0)
    block.get("excessBlobGas", 0),           # excessBlobGas (default to 0)
    HexBytes(block.get("parentBeaconBlockRoot", b"0x")),  # parentBeaconBlockRoot (default to empty)
]

# RLP encoding
encoded_header = rlp.encode(block_header)

# Compute blockhash
blockhash = keccak(encoded_header)

print(f"FAKE_BLOCK_HASH=0x{blockhash.hex()}")
print(f"BLOCK_HEADER_HEX={encoded_header.hex()}")

# anvil
# python src/block.py
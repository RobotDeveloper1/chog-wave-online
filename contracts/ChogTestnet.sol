// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Chog Testnet — a disposable ERC-721 for the Monad testnet (chain 10143).
 *
 * This is NOT the Genesis collection. It exists so logins, holdings and joins
 * can be exercised end to end without touching mainnet: mint a handful of ids
 * to a Privy embedded wallet and the game treats them like Chogs (builds are
 * derived from the token id when no real trait metadata exists, the same path
 * foster Chogs already walk).
 *
 * Deliberately dependency-free (no OpenZeppelin) so it compiles with stock
 * solc: ownerOf/balanceOf/transferFrom/approve plus the Transfer/Approval
 * events the server's ownership index feeds on. No enumerable — the server
 * reads ownerOf per id, exactly like it does on mainnet.
 */
contract ChogTestnet {
    string public name = "Chog Testnet";
    string public symbol = "tCHOG";

    uint256 public totalSupply;
    string public baseURI;
    address public owner;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed spender, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(string memory baseURI_) {
        owner = msg.sender;
        baseURI = baseURI_;
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        baseURI = baseURI_;
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), "zero owner");
        owner = next;
    }

    /** Mint `to` the next ids. Testnet only: free, uncapped, owner-gated. */
    function mint(address to, uint256 count) external onlyOwner returns (uint256 first) {
        require(to != address(0), "zero to");
        first = totalSupply + 1;
        for (uint256 i = 0; i < count; i++) {
            uint256 id = first + i;
            _ownerOf[id] = to;
            unchecked { _balanceOf[to] += 1; }
            emit Transfer(address(0), to, id);
        }
        totalSupply += count;
    }

    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_ownerOf[tokenId] != address(0), "no such token");
        return string.concat(baseURI, uint2str(tokenId), ".json");
    }

    function balanceOf(address holder) public view returns (uint256) {
        require(holder != address(0), "zero holder");
        return _balanceOf[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address holder = _ownerOf[tokenId];
        require(holder != address(0), "no such token");
        return holder;
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        require(_ownerOf[tokenId] != address(0), "no such token");
        return _approved[tokenId];
    }

    function isApprovedForAll(address holder, address operator) public view returns (bool) {
        return _operator[holder][operator];
    }

    function approve(address spender, uint256 tokenId) public {
        address holder = _ownerOf[tokenId];
        require(msg.sender == holder || _operator[holder][msg.sender], "not allowed");
        _approved[tokenId] = spender;
        emit Approval(holder, spender, tokenId);
    }

    function setApprovalForAll(address operator, bool ok) public {
        _operator[msg.sender][operator] = ok;
        emit ApprovalForAll(msg.sender, operator, ok);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(to != address(0), "zero to");
        address holder = _ownerOf[tokenId];
        require(holder == from, "not holder");
        require(
            msg.sender == holder || _approved[tokenId] == msg.sender || _operator[holder][msg.sender],
            "not allowed"
        );
        delete _approved[tokenId];
        unchecked {
            _balanceOf[from] -= 1;
            _balanceOf[to] += 1;
        }
        _ownerOf[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    function uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        uint256 x = v;
        while (x != 0) { digits++; x /= 10; }
        bytes memory out = new bytes(digits);
        while (v != 0) { digits--; out[digits] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(out);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Wick Runner on-chain records and leaderboards (Robinhood Chain testnet, 46630).
/// The game server replays every ranked run; only runs it verified carry its signature, bound to this chain,
/// this contract, the player's wallet, the board, the score, the run id and an expiry. The player sends the
/// transaction from their own wallet. The ranking rule matches the server database: best score per wallet,
/// highest first, an earlier record wins a tie; banned wallets never appear.
contract WickRunnerScores {
    uint256 public constant TOP = 10;
    struct Entry { address player; uint64 score; uint64 seq; } // seq: when the best was set (run counter), breaks ties

    address public owner;
    address public pendingOwner;
    address public verifier;
    bool public paused;
    uint256 public runs;

    mapping(bytes32 => bool) public used;                       // run id -> recorded (also blocks replays)
    mapping(bytes32 => mapping(address => uint64)) public best; // board -> player -> best score
    mapping(bytes32 => mapping(address => uint64)) public bestSeq; // board -> player -> run counter when that best was set
    mapping(address => bool) public banned;
    mapping(bytes32 => Entry[]) private boards;                 // board -> top list, sorted

    event Run(address indexed player, bytes32 indexed board, uint64 score, bytes32 indexed runId, bool newBest);
    event Banned(address indexed player, bool on);
    event VerifierChanged(address verifier);
    event Paused(bool on);
    event OwnerChanged(address owner);

    error NotOwner(); error IsPaused(); error IsBanned(); error Recorded(); error Expired(); error BadSignature(); error BadInput();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(address _verifier) {
        if (_verifier == address(0)) revert BadInput();
        owner = msg.sender; verifier = _verifier;
        emit OwnerChanged(msg.sender); emit VerifierChanged(_verifier);
    }

    // ---- players ----
    function record(bytes32 board, uint64 score, bytes32 runId, uint64 deadline, bytes calldata sig) external {
        if (paused) revert IsPaused();
        if (banned[msg.sender]) revert IsBanned();
        if (used[runId]) revert Recorded();
        if (block.timestamp > deadline) revert Expired();
        bytes32 h = keccak256(abi.encode(block.chainid, address(this), msg.sender, board, score, runId, deadline));
        if (_recover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h)), sig) != verifier) revert BadSignature();
        used[runId] = true; runs++;
        bool nb = score > best[board][msg.sender];
        if (nb) { best[board][msg.sender] = score; bestSeq[board][msg.sender] = uint64(runs); _rank(board, msg.sender, score, uint64(runs)); }
        emit Run(msg.sender, board, score, runId, nb);
    }

    function top(bytes32 board) external view returns (Entry[] memory) { return boards[board]; }

    // ---- moderation (owner) ----
    /// Ban or unban wallets. A ban removes them from the given boards; unban puts their stored best back.
    function setBanned(address[] calldata players, bool on, bytes32[] calldata onBoards) external onlyOwner {
        for (uint256 i; i < players.length; i++) {
            address p = players[i];
            if (banned[p] == on) continue;
            banned[p] = on; emit Banned(p, on);
            for (uint256 j; j < onBoards.length; j++) {
                if (on) _remove(onBoards[j], p); else if (best[onBoards[j]][p] > 0) _rank(onBoards[j], p, best[onBoards[j]][p], bestSeq[onBoards[j]][p]);
            }
        }
    }
    /// Re-fill a board from stored bests (e.g. after a ban opened a slot). Uses only on-chain data, so it can't add scores.
    function refill(bytes32 board, address[] calldata players) external onlyOwner {
        for (uint256 i; i < players.length; i++) { address p = players[i]; uint64 s = best[board][p]; if (s > 0 && !banned[p]) _rank(board, p, s, bestSeq[board][p]); }
    }
    function setVerifier(address v) external onlyOwner { if (v == address(0)) revert BadInput(); verifier = v; emit VerifierChanged(v); } // rotating voids every old signature
    function setPaused(bool on) external onlyOwner { paused = on; emit Paused(on); }
    function transferOwnership(address p) external onlyOwner { pendingOwner = p; }
    function acceptOwnership() external { if (msg.sender != pendingOwner) revert NotOwner(); owner = msg.sender; pendingOwner = address(0); emit OwnerChanged(msg.sender); }

    // ---- internals ----
    function _rank(bytes32 board, address p, uint64 score, uint64 seq) private {
        Entry[] storage b = boards[board];
        uint256 n = b.length; uint256 i = n;
        for (uint256 k; k < n; k++) if (b[k].player == p) { i = k; break; }
        if (i == n) {
            if (n < TOP) b.push(Entry(p, score, seq));                                   // i == n is the new slot
            else if (_before(score, seq, b[n - 1])) i = n - 1;                             // replaces last place
            else return;
        } else if (!_before(score, seq, b[i])) return;                              // already there with this or better
        while (i > 0 && _before(score, seq, b[i - 1])) { b[i] = b[i - 1]; i--; }
        b[i] = Entry(p, score, seq);
    }
    function _before(uint64 score, uint64 seq, Entry storage e) private view returns (bool) { return score > e.score || (score == e.score && seq < e.seq); }
    function _remove(bytes32 board, address p) private {
        Entry[] storage b = boards[board];
        uint256 n = b.length;
        for (uint256 i; i < n; i++) if (b[i].player == p) { for (uint256 k = i; k + 1 < n; k++) b[k] = b[k + 1]; b.pop(); return; }
    }
    function _recover(bytes32 d, bytes calldata sig) private pure returns (address a) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]); bytes32 s = bytes32(sig[32:64]); uint8 v = uint8(sig[64]);
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature(); // no malleable sigs
        a = ecrecover(d, v, r, s); if (a == address(0)) revert BadSignature();
    }
}

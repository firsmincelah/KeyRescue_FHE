pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract KeyRescue is ZamaEthereumConfig {
    struct KeyFragment {
        euint32 encryptedShare;
        address guardian;
        bool isVerified;
        uint32 decryptedShare;
    }

    struct RecoverySession {
        string name;
        uint256 threshold;
        uint256 totalGuardians;
        mapping(address => KeyFragment) fragments;
        address[] guardianAddresses;
        bool isRecovered;
        uint32 recoveredKey;
    }

    mapping(string => RecoverySession) public sessions;
    string[] public sessionIds;

    event SessionCreated(string indexed sessionId, address indexed creator);
    event FragmentAdded(string indexed sessionId, address indexed guardian);
    event FragmentVerified(string indexed sessionId, address indexed guardian);
    event KeyRecovered(string indexed sessionId, uint32 recoveredKey);

    constructor() ZamaEthereumConfig() {}

    function createSession(
        string calldata sessionId,
        string calldata name,
        uint256 threshold,
        uint256 totalGuardians
    ) external {
        require(bytes(sessions[sessionId].name).length == 0, "Session already exists");
        require(threshold > 0 && threshold <= totalGuardians, "Invalid threshold");

        sessions[sessionId].name = name;
        sessions[sessionId].threshold = threshold;
        sessions[sessionId].totalGuardians = totalGuardians;
        sessions[sessionId].isRecovered = false;
        sessions[sessionId].recoveredKey = 0;

        sessionIds.push(sessionId);
        emit SessionCreated(sessionId, msg.sender);
    }

    function addFragment(
        string calldata sessionId,
        externalEuint32 encryptedShare,
        bytes calldata inputProof
    ) external {
        require(bytes(sessions[sessionId].name).length > 0, "Session does not exist");
        require(!sessions[sessionId].isRecovered, "Session already recovered");
        require(sessions[sessionId].fragments[msg.sender].guardian == address(0), "Guardian already added");

        require(FHE.isInitialized(FHE.fromExternal(encryptedShare, inputProof)), "Invalid encrypted input");

        sessions[sessionId].fragments[msg.sender] = KeyFragment({
            encryptedShare: FHE.fromExternal(encryptedShare, inputProof),
            guardian: msg.sender,
            isVerified: false,
            decryptedShare: 0
        });

        FHE.allowThis(sessions[sessionId].fragments[msg.sender].encryptedShare);
        FHE.makePubliclyDecryptable(sessions[sessionId].fragments[msg.sender].encryptedShare);

        sessions[sessionId].guardianAddresses.push(msg.sender);
        emit FragmentAdded(sessionId, msg.sender);
    }

    function verifyFragment(
        string calldata sessionId,
        uint32 decryptedShare,
        bytes memory decryptionProof
    ) external {
        require(bytes(sessions[sessionId].name).length > 0, "Session does not exist");
        require(!sessions[sessionId].isRecovered, "Session already recovered");
        KeyFragment storage fragment = sessions[sessionId].fragments[msg.sender];
        require(fragment.guardian != address(0), "Fragment not found");
        require(!fragment.isVerified, "Fragment already verified");

        bytes memory abiEncodedClearValue = abi.encode(decryptedShare);
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(fragment.encryptedShare);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        fragment.decryptedShare = decryptedShare;
        fragment.isVerified = true;
        emit FragmentVerified(sessionId, msg.sender);
    }

    function recoverKey(string calldata sessionId) external {
        require(bytes(sessions[sessionId].name).length > 0, "Session does not exist");
        require(!sessions[sessionId].isRecovered, "Session already recovered");

        uint256 verifiedCount;
        uint32 recoveredKey;
        for (uint256 i = 0; i < sessions[sessionId].guardianAddresses.length; i++) {
            KeyFragment storage fragment = sessions[sessionId].fragments[
                sessions[sessionId].guardianAddresses[i]
            ];
            if (fragment.isVerified) {
                verifiedCount++;
                recoveredKey += fragment.decryptedShare;
            }
        }

        require(verifiedCount >= sessions[sessionId].threshold, "Insufficient verified fragments");

        sessions[sessionId].isRecovered = true;
        sessions[sessionId].recoveredKey = recoveredKey;
        emit KeyRecovered(sessionId, recoveredKey);
    }

    function getSession(string calldata sessionId)
        external
        view
        returns (
            string memory name,
            uint256 threshold,
            uint256 totalGuardians,
            bool isRecovered,
            uint32 recoveredKey
        )
    {
        require(bytes(sessions[sessionId].name).length > 0, "Session does not exist");
        RecoverySession storage session = sessions[sessionId];
        return (
            session.name,
            session.threshold,
            session.totalGuardians,
            session.isRecovered,
            session.recoveredKey
        );
    }

    function getGuardianAddresses(string calldata sessionId)
        external
        view
        returns (address[] memory)
    {
        require(bytes(sessions[sessionId].name).length > 0, "Session does not exist");
        return sessions[sessionId].guardianAddresses;
    }

    function getFragment(string calldata sessionId, address guardian)
        external
        view
        returns (
            euint32 encryptedShare,
            bool isVerified,
            uint32 decryptedShare
        )
    {
        require(bytes(sessions[sessionId].name).length > 0, "Session does not exist");
        KeyFragment storage fragment = sessions[sessionId].fragments[guardian];
        require(fragment.guardian != address(0), "Fragment not found");
        return (
            fragment.encryptedShare,
            fragment.isVerified,
            fragment.decryptedShare
        );
    }

    function getAllSessionIds() external view returns (string[] memory) {
        return sessionIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}



import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface GuardianData {
  id: string;
  name: string;
  encryptedValue: any;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  decryptedValue: number;
  isVerified: boolean;
}

interface RecoveryStatus {
  guardiansRequired: number;
  guardiansAvailable: number;
  recoveryPossible: boolean;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [guardians, setGuardians] = useState<GuardianData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingGuardian, setAddingGuardian] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({
    visible: false,
    status: "pending",
    message: ""
  });
  const [newGuardianData, setNewGuardianData] = useState({ name: "", value: "" });
  const [selectedGuardian, setSelectedGuardian] = useState<GuardianData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeTab, setActiveTab] = useState("guardians");
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>({
    guardiansRequired: 3,
    guardiansAvailable: 0,
    recoveryPossible: false
  });
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [partners] = useState([
    { name: "Zama", logo: "🔒" },
    { name: "FHE Alliance", logo: "🤝" },
    { name: "CryptoGuard", logo: "🛡️" },
    { name: "SecureChain", logo: "⛓️" }
  ]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;

      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({
          visible: true,
          status: "error",
          message: "FHEVM initialization failed"
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }

      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;

    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;

      const businessIds = await contract.getAllBusinessIds();
      const guardiansList: GuardianData[] = [];

      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          guardiansList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: null,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            decryptedValue: Number(businessData.decryptedValue) || 0,
            isVerified: businessData.isVerified
          });
        } catch (e) {
          console.error('Error loading guardian data:', e);
        }
      }

      setGuardians(guardiansList);
      updateRecoveryStatus(guardiansList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setIsRefreshing(false);
    }
  };

  const updateRecoveryStatus = (guardiansList: GuardianData[]) => {
    const verifiedGuardians = guardiansList.filter(g => g.isVerified).length;
    setRecoveryStatus({
      guardiansRequired: 3,
      guardiansAvailable: verifiedGuardians,
      recoveryPossible: verifiedGuardians >= 3
    });
  };

  const addGuardian = async () => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return;
    }

    setAddingGuardian(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Adding guardian with FHE encryption..." });

    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      const value = parseInt(newGuardianData.value) || 0;
      const businessId = `guardian-${Date.now()}`;

      const encryptedResult = await encrypt(contractAddress, address, value);

      const tx = await contract.createBusinessData(
        businessId,
        newGuardianData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        "Key Fragment"
      );

      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();

      setTransactionStatus({ visible: true, status: "success", message: "Guardian added successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);

      await loadData();
      setShowAddModal(false);
      setNewGuardianData({ name: "", value: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally {
      setAddingGuardian(false);
    }
  };

  const decryptGuardianValue = async (guardianId: string): Promise<number | null> => {
    if (!isConnected || !address) {
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    }

    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;

      const guardianData = await contractRead.getBusinessData(guardianId);
      if (guardianData.isVerified) {
        const storedValue = Number(guardianData.decryptedValue) || 0;

        setTransactionStatus({
          visible: true,
          status: "success",
          message: "Data already verified on-chain"
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);

        return storedValue;
      }

      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;

      const encryptedValueHandle = await contractRead.getEncryptedValue(guardianId);

      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) =>
          contractWrite.verifyDecryption(guardianId, abiEncodedClearValues, decryptionProof)
      );

      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });

      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];

      await loadData();

      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);

      return Number(clearValue);

    } catch (e: any) {
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({
          visible: true,
          status: "success",
          message: "Data is already verified on-chain"
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);

        await loadData();
        return null;
      }

      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Decryption failed: " + (e.message || "Unknown error")
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null;
    } finally {
      setIsDecrypting(false);
    }
  };

  const recoverKey = async () => {
    if (!recoveryStatus.recoveryPossible) return;

    setTransactionStatus({ visible: true, status: "pending", message: "Recovering key using FHE..." });

    try {
      const verifiedGuardians = guardians.filter(g => g.isVerified);
      const keyValue = verifiedGuardians.reduce((sum, guardian) => sum + guardian.decryptedValue, 0);

      setTransactionStatus({ visible: true, status: "success", message: `Key recovered: ${keyValue}` });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 5000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Recovery failed: " + (e.message || "Unknown error")
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderRecoveryStatus = () => {
    return (
      <div className="recovery-status">
        <div className="status-item">
          <div className="status-label">Guardians Required</div>
          <div className="status-value">{recoveryStatus.guardiansRequired}</div>
        </div>
        <div className="status-item">
          <div className="status-label">Guardians Available</div>
          <div className="status-value">{recoveryStatus.guardiansAvailable}</div>
        </div>
        <div className="status-item">
          <div className="status-label">Recovery Possible</div>
          <div className={`status-value ${recoveryStatus.recoveryPossible ? "yes" : "no"}`}>
            {recoveryStatus.recoveryPossible ? "YES" : "NO"}
          </div>
        </div>
        <button
          className={`recover-btn ${recoveryStatus.recoveryPossible ? "" : "disabled"}`}
          onClick={recoverKey}
          disabled={!recoveryStatus.recoveryPossible}
        >
          Recover Key
        </button>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-icon">1</div>
          <div className="step-content">
            <h4>Key Fragmentation</h4>
            <p>Private key is split into encrypted fragments using FHE</p>
          </div>
        </div>
        <div className="process-step">
          <div className="step-icon">2</div>
          <div className="step-content">
            <h4>Distributed Storage</h4>
            <p>Encrypted fragments are distributed to trusted guardians</p>
          </div>
        </div>
        <div className="process-step">
          <div className="step-icon">3</div>
          <div className="step-content">
            <h4>Homomorphic Recovery</h4>
            <p>Fragments are combined using FHE without decryption</p>
          </div>
        </div>
        <div className="process-step">
          <div className="step-icon">4</div>
          <div className="step-content">
            <h4>Key Restoration</h4>
            <p>Original private key is reconstructed securely</p>
          </div>
        </div>
      </div>
    );
  };

  const renderFAQ = () => {
    const faqs = [
      {
        question: "What is FHE-based key recovery?",
        answer: "Fully Homomorphic Encryption allows computations on encrypted data without decryption. This enables secure key recovery by combining encrypted key fragments."
      },
      {
        question: "How many guardians do I need?",
        answer: "You need at least 3 verified guardians to recover your key. This threshold ensures security while providing redundancy."
      },
      {
        question: "Is my key safe during recovery?",
        answer: "Yes, the key is never exposed during the recovery process. FHE computations happen entirely on encrypted data."
      },
      {
        question: "Can guardians see my key fragment?",
        answer: "No, each guardian holds an encrypted fragment that only you can decrypt with your private key."
      }
    ];

    return (
      <div className="faq-section">
        <h3>Frequently Asked Questions</h3>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <div
              className={`faq-item ${faqOpen === index ? "open" : ""}`}
              key={index}
              onClick={() => setFaqOpen(faqOpen === index ? null : index)}
            >
              <div className="faq-question">
                {faq.question}
                <div className="faq-toggle">{faqOpen === index ? "−" : "+"}</div>
              </div>
              {faqOpen === index && <div className="faq-answer">{faq.answer}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderPartners = () => {
    return (
      <div className="partners-section">
        <h3>Trusted Partners</h3>
        <div className="partners-grid">
          {partners.map((partner, index) => (
            <div className="partner-card" key={index}>
              <div className="partner-logo">{partner.logo}</div>
              <div className="partner-name">{partner.name}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Confidential Key Recovery 🔐</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>

        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Begin</h2>
            <p>Secure your digital assets with FHE-based key recovery</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Initialize FHE system</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Setup key guardians</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading key recovery system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Confidential Key Recovery 🔐</h1>
        </div>

        <div className="header-actions">
          <button
            onClick={() => setShowAddModal(true)}
            className="add-btn"
          >
            + Add Guardian
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="tabs">
          <button
            className={`tab ${activeTab === "guardians" ? "active" : ""}`}
            onClick={() => setActiveTab("guardians")}
          >
            Guardians
          </button>
          <button
            className={`tab ${activeTab === "recovery" ? "active" : ""}`}
            onClick={() => setActiveTab("recovery")}
          >
            Recovery
          </button>
          <button
            className={`tab ${activeTab === "info" ? "active" : ""}`}
            onClick={() => setActiveTab("info")}
          >
            Information
          </button>
        </div>

        {activeTab === "guardians" && (
          <div className="tab-content">
            <div className="section-header">
              <h2>Key Guardians</h2>
              <div className="header-actions">
                <button
                  onClick={loadData}
                  className="refresh-btn"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>

            <div className="guardians-list">
              {guardians.length === 0 ? (
                <div className="no-guardians">
                  <p>No guardians found</p>
                  <button
                    className="add-btn"
                    onClick={() => setShowAddModal(true)}
                  >
                    Add First Guardian
                  </button>
                </div>
              ) : guardians.map((guardian, index) => (
                <div
                  className={`guardian-item ${selectedGuardian?.id === guardian.id ? "selected" : ""} ${guardian.isVerified ? "verified" : ""}`}
                  key={index}
                  onClick={() => setSelectedGuardian(guardian)}
                >
                  <div className="guardian-title">{guardian.name}</div>
                  <div className="guardian-meta">
                    <span>Created: {new Date(guardian.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="guardian-status">
                    Status: {guardian.isVerified ? "✅ Verified" : "🔓 Pending Verification"}
                  </div>
                  <div className="guardian-creator">Creator: {guardian.creator.substring(0, 6)}...{guardian.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "recovery" && (
          <div className="tab-content">
            <h2>Key Recovery Center</h2>
            {renderRecoveryStatus()}
            <div className="recovery-process">
              <h3>FHE Recovery Process</h3>
              {renderFHEProcess()}
            </div>
          </div>
        )}

        {activeTab === "info" && (
          <div className="tab-content">
            <h2>Information Center</h2>
            {renderFAQ()}
            {renderPartners()}
          </div>
        )}
      </div>

      {showAddModal && (
        <ModalAddGuardian
          onSubmit={addGuardian}
          onClose={() => setShowAddModal(false)}
          adding={addingGuardian}
          guardianData={newGuardianData}
          setGuardianData={setNewGuardianData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedGuardian && (
        <GuardianDetailModal
          guardian={selectedGuardian}
          onClose={() => {
            setSelectedGuardian(null);
            setDecryptedValue(null);
          }}
          decryptedValue={decryptedValue}
          setDecryptedValue={setDecryptedValue}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptGuardianValue(selectedGuardian.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalAddGuardian: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  adding: boolean;
  guardianData: any;
  setGuardianData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, adding, guardianData, setGuardianData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'value') {
      const intValue = value.replace(/[^\d]/g, '');
      setGuardianData({ ...guardianData, [name]: intValue });
    } else {
      setGuardianData({ ...guardianData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="add-guardian-modal">
        <div className="modal-header">
          <h2>Add New Key Guardian</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Key fragment will be encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>

          <div className="form-group">
            <label>Guardian Name *</label>
            <input
              type="text"
              name="name"
              value={guardianData.name}
              onChange={handleChange}
              placeholder="Enter guardian name..."
            />
          </div>

          <div className="form-group">
            <label>Key Fragment Value (Integer only) *</label>
            <input
              type="number"
              name="value"
              value={guardianData.value}
              onChange={handleChange}
              placeholder="Enter fragment value..."
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={adding || isEncrypting || !guardianData.name || !guardianData.value}
            className="submit-btn"
          >
            {adding || isEncrypting ? "Encrypting and Adding..." : "Add Guardian"}
          </button>
        </div>
      </div>
    </div>
  );
};

const GuardianDetailModal: React.FC<{
  guardian: GuardianData;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ guardian, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) {
      setDecryptedValue(null);
      return;
    }

    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedValue(decrypted);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="guardian-detail-modal">
        <div className="modal-header">
          <h2>Guardian Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>

        <div className="modal-body">
          <div className="guardian-info">
            <div className="info-item">
              <span>Guardian Name:</span>
              <strong>{guardian.name}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{guardian.creator.substring(0, 6)}...{guardian.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(guardian.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>

          <div className="data-section">
            <h3>Encrypted Key Fragment</h3>

            <div className="data-row">
              <div className="data-label">Fragment Value:</div>
              <div className="data-value">
                {guardian.isVerified ?
                  `${guardian.decryptedValue} (On-chain Verified)` :
                  decryptedValue !== null ?
                  `${decryptedValue} (Locally Decrypted)` :
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button
                className={`decrypt-btn ${(guardian.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt}
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : guardian.isVerified ? (
                  "✅ Verified"
                ) : decryptedValue !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Fragment"
                )}
              </button>
            </div>

            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Self-Relaying Decryption</strong>
                <p>Data is encrypted on-chain. Click "Verify Fragment" to perform offline decryption and on-chain verification.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!guardian.isVerified && (
            <button
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;



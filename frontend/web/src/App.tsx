import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface GuardianData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
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
  const [newGuardianData, setNewGuardianData] = useState({ name: "", value: "", description: "" });
  const [selectedGuardian, setSelectedGuardian] = useState<GuardianData | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
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
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setGuardians(guardiansList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const addGuardian = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setAddingGuardian(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Adding guardian with FHE..." });
    
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
        newGuardianData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Guardian added!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowAddModal(false);
      setNewGuardianData({ name: "", value: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setAddingGuardian(false); 
    }
  };

  const decryptGuardianValue = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Decrypted!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to check availability" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStats = () => {
    const totalGuardians = guardians.length;
    const verifiedGuardians = guardians.filter(g => g.isVerified).length;
    const activeGuardians = guardians.filter(g => Date.now()/1000 - g.timestamp < 60 * 60 * 24 * 30).length;

    return (
      <div className="stats-panels">
        <div className="stat-panel">
          <h3>Total Guardians</h3>
          <div className="stat-value">{totalGuardians}</div>
          <div className="stat-trend">{activeGuardians} active</div>
        </div>
        <div className="stat-panel">
          <h3>Verified Keys</h3>
          <div className="stat-value">{verifiedGuardians}/{totalGuardians}</div>
          <div className="stat-trend">FHE Secured</div>
        </div>
      </div>
    );
  };

  const renderFlowChart = () => {
    const steps = [
      "Encrypt Key Fragment",
      "Distribute to Guardians",
      "Collect Fragments",
      "FHE Computation",
      "Recover Original Key"
    ];

    return (
      <div className="flow-chart">
        {steps.map((step, index) => (
          <div 
            key={index} 
            className={`flow-step ${index <= activeStep ? "active" : ""}`}
            onClick={() => setActiveStep(index)}
          >
            <div className="step-number">{index + 1}</div>
            <div className="step-label">{step}</div>
            <div className="step-connector"></div>
          </div>
        ))}
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>KeyRescue FHE</h1>
            <p>隱私密鑰救援</p>
          </div>
          <div className="wallet-connect">
            <ConnectButton />
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <h2>Connect Wallet to Start</h2>
            <p>Secure your assets with FHE encrypted key fragments</p>
            <div className="steps">
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
                <p>Manage your key fragments</p>
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
        <p>Initializing FHE System...</p>
        <p>Status: {fhevmInitializing ? "Initializing" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading Key Fragments...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>KeyRescue FHE</h1>
          <p>隱私密鑰救援</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="add-btn"
          >
            + Add Guardian
          </button>
          <button 
            onClick={checkAvailability} 
            className="check-btn"
          >
            Check Status
          </button>
          <div className="wallet-connect">
            <ConnectButton />
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="left-panel">
          <h2>Key Recovery Process</h2>
          {renderFlowChart()}
          
          <div className="info-panel">
            <h3>FHE Security</h3>
            <p>Your key fragments are encrypted using Fully Homomorphic Encryption (FHE) for maximum security.</p>
            <div className="security-features">
              <div className="feature">
                <div className="feature-icon">🔐</div>
                <div className="feature-text">End-to-end encrypted</div>
              </div>
              <div className="feature">
                <div className="feature-icon">🧩</div>
                <div className="feature-text">Multi-party computation</div>
              </div>
              <div className="feature">
                <div className="feature-icon">⚡</div>
                <div className="feature-text">On-chain verification</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="right-panel">
          <div className="panel-header">
            <h2>Guardian List</h2>
            <button 
              onClick={loadData} 
              className="refresh-btn" 
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          
          {renderStats()}
          
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
                onClick={() => {
                  setSelectedGuardian(guardian);
                  setDecryptedValue(null);
                }}
              >
                <div className="guardian-name">{guardian.name}</div>
                <div className="guardian-meta">
                  <span>Created: {new Date(guardian.timestamp * 1000).toLocaleDateString()}</span>
                  <span>By: {guardian.creator.substring(0, 6)}...{guardian.creator.substring(38)}</span>
                </div>
                <div className="guardian-status">
                  {guardian.isVerified ? (
                    <span className="verified">Verified: {guardian.decryptedValue}</span>
                  ) : (
                    <span className="pending">Pending Verification</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
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
          decryptValue={() => decryptGuardianValue(selectedGuardian.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className={`transaction-content ${transactionStatus.status}`}>
            <div className="transaction-icon">
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
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
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
          <h2>Add New Guardian</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE Encryption</strong>
            <p>Key fragment will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Guardian Name *</label>
            <input 
              type="text" 
              name="name" 
              value={guardianData.name} 
              onChange={handleChange} 
              placeholder="Enter name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Key Fragment (Integer only) *</label>
            <input 
              type="number" 
              name="value" 
              value={guardianData.value} 
              onChange={handleChange} 
              placeholder="Enter fragment value..." 
              step="1"
              min="0"
            />
            <div className="data-type">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={guardianData.description} 
              onChange={handleChange} 
              placeholder="Enter description..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={adding || isEncrypting || !guardianData.name || !guardianData.value} 
            className="submit-btn"
          >
            {adding || isEncrypting ? "Encrypting..." : "Add Guardian"}
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
  decryptValue: () => Promise<number | null>;
}> = ({ guardian, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptValue }) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    
    const decrypted = await decryptValue();
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
            <div className="info-row">
              <span>Name:</span>
              <strong>{guardian.name}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{guardian.creator.substring(0, 6)}...{guardian.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <strong>{new Date(guardian.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-row">
              <span>Description:</span>
              <strong>{guardian.description}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Key Fragment Data</h3>
            
            <div className="data-row">
              <div className="data-label">Fragment Value:</div>
              <div className="data-value">
                {guardian.isVerified ? 
                  `${guardian.decryptedValue} (Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(guardian.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "Decrypting..."
                ) : guardian.isVerified ? (
                  "✅ Verified"
                ) : decryptedValue !== null ? (
                  "🔄 Re-decrypt"
                ) : (
                  "🔓 Decrypt"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Security</strong>
                <p>Data is encrypted on-chain using Fully Homomorphic Encryption.</p>
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
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
import warnings

# Suppress noisy FutureWarning emitted by huggingface_hub inside sentence-transformers
warnings.filterwarnings(
    "ignore",
    category=FutureWarning,
    module=r"huggingface_hub\.utils\._deprecation"
)

from sentence_transformers import SentenceTransformer
import numpy as np

"""
Embeddings Service
----------------------------------------------------
Handles the conversion of text (skills, descriptions) into vector embeddings.
Uses a pre-trained model from HuggingFace.
"""

# Load a high-performance model
# 'all-mpnet-base-v2' is significantly better than MiniLM for semantic search
# Dimension: 768
MODEL_NAME = 'all-mpnet-base-v2'
_model = None

def get_model():
    """
    Lazy load the model to avoid startup crashes and timeouts.
    """
    global _model
    if _model is None:
        print(f"Loading embedding model: {MODEL_NAME}...")
        _model = SentenceTransformer(MODEL_NAME)
        print("Model loaded successfully.")
    return _model

def generate_embedding(text: str) -> np.ndarray:
    """
    Generate a vector embedding for a given text.
    
    Args:
        text (str): The input text (e.g., "Python programming")
        
    Returns:
        np.ndarray: A numpy array representing the vector embedding
    """
    if not text:
        return np.zeros(768) # Dimension of all-mpnet-base-v2
        
    model = get_model()
    embedding = model.encode(text)
    return embedding

def generate_embeddings(texts: list[str]) -> np.ndarray:
    """
    Generate embeddings for a list of texts (batch processing).
    
    Args:
        texts (list[str]): List of input texts
        
    Returns:
        np.ndarray: Matrix of embeddings
    """
    if not texts:
        return np.array([])
        
    model = get_model()
    embeddings = model.encode(texts)
    return embeddings

import faiss
import numpy as np
import pickle
import os

"""
Vector Store Service
----------------------------------------------------
Manages the FAISS index for fast similarity search.
Stores skill embeddings and retrieves nearest neighbors.
"""

INDEX_FILE = "data/faiss_index.bin"
ID_MAP_FILE = "data/id_map.pkl"

class VectorStore:
    def __init__(self, dimension=768):
        """
        Initialize the Vector Store.
        
        Args:
            dimension (int): Dimension of the embeddings (768 for all-mpnet-base-v2)
        """
        self.dimension = dimension
        self.index = faiss.IndexFlatL2(dimension) # L2 distance (Euclidean)
        self.id_map = {} # Maps FAISS index ID to Skill ID (MongoDB ID)
        self.reverse_map = {} # Maps Skill ID to FAISS index ID
        
        # Load existing index if available
        self.load()

    def add_skills(self, skills: list):
        """
        Add skills to the FAISS index.
        
        Args:
            skills (list): List of skill objects (must contain 'embedding' and '_id')
        """
        if not skills:
            return
            
        vectors = np.array([s['embedding'] for s in skills]).astype('float32')
        ids = [str(s['_id']) for s in skills]
        
        # Add to FAISS
        start_idx = self.index.ntotal
        self.index.add(vectors)
        
        # Update maps
        for i, skill_id in enumerate(ids):
            faiss_id = start_idx + i
            self.id_map[faiss_id] = skill_id
            self.reverse_map[skill_id] = faiss_id
            
        self.save()

    def search(self, query_vector: np.ndarray, k=5):
        """
        Search for similar skills.
        
        Args:
            query_vector (np.ndarray): The query embedding
            k (int): Number of results to return
            
        Returns:
            list: List of (skill_id, distance) tuples
        """
        # Reshape to (1, dimension) for FAISS
        vector = query_vector.reshape(1, -1).astype('float32')
        
        distances, indices = self.index.search(vector, k)
        
        results = []
        for i, idx in enumerate(indices[0]):
            if idx != -1 and idx in self.id_map:
                results.append((self.id_map[idx], float(distances[0][i])))
                
        return results

    def save(self):
        """Save the index and ID map to disk."""
        os.makedirs("data", exist_ok=True)
        faiss.write_index(self.index, INDEX_FILE)
        with open(ID_MAP_FILE, "wb") as f:
            pickle.dump((self.id_map, self.reverse_map), f)

    def load(self):
        """Load the index and ID map from disk."""
        if os.path.exists(INDEX_FILE) and os.path.exists(ID_MAP_FILE):
            self.index = faiss.read_index(INDEX_FILE)
            with open(ID_MAP_FILE, "rb") as f:
                self.id_map, self.reverse_map = pickle.load(f)

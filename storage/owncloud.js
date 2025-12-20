import { MediaItem } from '@/types';

// Use environment variable for API URL
const RAW_API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const UPGRADED_API_URL = RAW_API_URL.startsWith('http://')
  ? RAW_API_URL.replace(/^http:\/\//, 'https://')
  : RAW_API_URL;
export const API_URL = import.meta.env.DEV ? '' : UPGRADED_API_URL;

export interface OwnCloudAuth {
  username: string;
  password: string;
}

// Helper to get auth headers if we implement JWT later
export const getAuthHeaders = (auth: OwnCloudAuth | null) => {
  return {
    'Content-Type': 'application/json'
  };
};

export const ownCloudService = {
  // Check if organization exists (for login)
  verifyCredentials: async (auth: OwnCloudAuth): Promise<boolean> => {
    try {
      console.log(`Verifying credentials for org: ${auth.username}`);
      
      // We must verify connectivity even for admin
      // The health check is a good way to verify the backend and OwnCloud connection
      const response = await fetch(`${API_URL}/api/health`);
      
      if (!response.ok) {
          console.error("Backend health check failed");
          return false;
      }

      const health = await response.json();
      if (health.status !== 'ok') {
          console.error("OwnCloud connection is down");
          return false;
      }

      // If it's admin/test, we assume valid if the server is healthy
      if (auth.username === 'test' || auth.username === 'admin') return true;

      // For regular orgs, check their specific folder existence
      const orgResponse = await fetch(`${API_URL}/api/orgs/${auth.username}`);
      if (!orgResponse.ok) return false;
      
      const data = await orgResponse.json();
      return data.exists;
    } catch (error) {
      console.error('Auth verification failed:', error);
      return false;
    }
  },

  listFiles: async (auth: OwnCloudAuth, path: string = '', targetUser?: string): Promise<MediaItem[]> => {
    const orgName = targetUser || auth.username;
    
    // If path is empty, we check both folders.
    const foldersToFetch = path ? [path] : ['videos', 'images'];
    let allItems: MediaItem[] = [];

    for (const folder of foldersToFetch) {
        // Clean folder name
        const cleanFolder = folder.replace(/^\//, '').replace(/\/$/, '');
        if (!cleanFolder) continue;

        try {
            const response = await fetch(`${API_URL}/api/list/${orgName}/${cleanFolder}`);
            if (!response.ok) continue;
            
            const items: any[] = await response.json();
            
            // Map WebDAV items to MediaItem
            const mappedItems: MediaItem[] = items
                .filter((item: any) => item.type === 'file') // Only files
                .map((item: any) => {
                    const type = cleanFolder.includes('video') ? 'video' : 'image';
                    const filename = item.basename;
                    // Public URL through our backend proxy
                    const url = `${API_URL}/api/files/stream?path=${encodeURIComponent(item.filename)}`;
                    
                    return {
                        id: item.filename, // full path
                        orgId: orgName,
                        type: type as 'video' | 'image',
                        filename: filename,
                        storagePath: item.filename,
                        visibility: 'public',
                        thumbnailUrl: type === 'image' ? url : undefined,
                        createdAt: new Date(item.lastmod),
                        size: item.size,
                        duration: 0,
                        transcoding: type === 'video' ? { status: 'done' } : undefined,
                    };
                });
            allItems = [...allItems, ...mappedItems];
        } catch (e) {
            console.warn(`Failed to list ${folder} for ${orgName}`, e);
        }
    }
    
    return allItems;
  },
  
  uploadFile: async (auth: OwnCloudAuth, folder: string, file: File, targetUser?: string): Promise<boolean> => {
     const orgName = targetUser || auth.username;
     const cleanFolder = folder.replace(/^\//, '').replace(/\/$/, '');
     
     const formData = new FormData();
     formData.append('file', file);
     formData.append('orgName', orgName);
     formData.append('folder', cleanFolder);

     try {
       const response = await fetch(`${API_URL}/api/upload`, {
         method: 'POST',
         body: formData
       });
       return response.ok;
     } catch (error) {
       console.error('Upload failed:', error);
       return false;
     }
  },

  updateOrg: async (auth: OwnCloudAuth, orgName: string, newName?: string, logoFile?: File): Promise<boolean> => {
      const formData = new FormData();
      if (newName) formData.append('newName', newName);
      if (logoFile) formData.append('logo', logoFile);

      try {
          const response = await fetch(`${API_URL}/api/orgs/${orgName}/update`, {
              method: 'POST',
              body: formData
          });
          return response.ok;
      } catch (error) {
          console.error('Update org failed:', error);
          return false;
      }
  },

  updateAdminLogo: async (auth: OwnCloudAuth, logoFile: File): Promise<boolean> => {
    const formData = new FormData();
    formData.append('logo', logoFile);

    try {
        const response = await fetch(`${API_URL}/api/admin/logo`, {
            method: 'POST',
            body: formData
        });
        return response.ok;
    } catch (error) {
        console.error('Update admin logo failed:', error);
        return false;
    }
  },

  getAdminLogoUrl: (): string => {
      // Return URL with timestamp to bust cache
      return `${API_URL}/api/admin/logo?t=${Date.now()}`;
  },
  
  createFolder: async (auth: OwnCloudAuth, path: string): Promise<boolean> => {
      return true; 
  },

  createUser: async (auth: OwnCloudAuth, newUser: { username: string; password?: string; logo?: File | null }): Promise<boolean> => {
       // Create Organization
       try {
           const formData = new FormData();
           formData.append('orgName', newUser.username);
           if (newUser.logo) {
               formData.append('logo', newUser.logo);
           }

           const response = await fetch(`${API_URL}/api/orgs/create`, {
               method: 'POST',
               // headers: { 'Content-Type': 'multipart/form-data' }, // Browser sets this automatically with boundary
               body: formData
           });
           return response.ok;
       } catch (error) {
           console.error('Create org error:', error);
           return false;
       }
   },

   getUsers: async (auth: OwnCloudAuth): Promise<string[]> => {
    // List Orgs
    try {
        const response = await fetch(`${API_URL}/api/orgs`);
        if (!response.ok) return [];
        const orgs = await response.json();
        return orgs.map((o: any) => o.name);
    } catch (error) {
        console.error('Get users error:', error);
        return [];
    }
   },

   getUserDetails: async (auth: OwnCloudAuth, userId: string): Promise<any> => {
       try {
           const response = await fetch(`${API_URL}/api/orgs/${userId}`);
           if (response.status === 404) return null;
           if (!response.ok) {
             throw new Error(`Server error: ${response.status} ${response.statusText}`);
           }
           const data = await response.json();
           
           return {
               displayname: data.name,
               quota: {
                   used: data.size // simplistic
               }
           };
       } catch (error) {
           console.error(`Get user details error for ${userId}:`, error);
           throw error;
       }
   },

  deleteFile: async (auth: OwnCloudAuth, path: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_URL}/api/files/delete`, {
        method: 'DELETE',
        headers: getAuthHeaders(auth),
        body: JSON.stringify({ path })
      });
      return response.ok;
    } catch (error) {
      console.error('Delete file error:', error);
      return false;
    }
  },

  moveFile: async (auth: OwnCloudAuth, source: string, destination: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_URL}/api/files/move`, {
        method: 'POST',
        headers: getAuthHeaders(auth),
        body: JSON.stringify({ source, destination })
      });
      return response.ok;
    } catch (error) {
      console.error('Move file error:', error);
      return false;
    }
  }
};

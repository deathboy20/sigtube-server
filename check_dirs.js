const { owncloud } = require("./storage/owncloud");

async function check() {
    try {
        const contents = await owncloud.getDirectoryContents("/organizations");
        console.log("Organizations contents:", contents.map(c => c.basename));
        
        // Also check Marketing if it exists
        if (contents.find(c => c.basename === 'Marketing')) {
             const marketing = await owncloud.getDirectoryContents("/organizations/Marketing");
             console.log("Marketing contents:", marketing.map(c => c.basename));
             
             // Check videos and images
             if (marketing.find(c => c.basename === 'videos')) {
                 const videos = await owncloud.getDirectoryContents("/organizations/Marketing/videos");
                 console.log("Marketing/videos contents:", videos.map(c => c.basename));
             }
             if (marketing.find(c => c.basename === 'images')) {
                 const images = await owncloud.getDirectoryContents("/organizations/Marketing/images");
                 console.log("Marketing/images contents:", images.map(c => c.basename));
             }
        }
    } catch (e) {
        console.error("Error listing organizations:", e);
    }
}

check();

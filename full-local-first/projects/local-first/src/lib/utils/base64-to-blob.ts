/**
 * Converts a base64 string to a Blob object.
 *
 * @param base64 The base64 string to convert.
 * @param contentType The content type of the data (e.g., 'image/png', 'application/pdf'). Defaults to ''.
 * @param sliceSize The size of the slices to process the byte characters. Defaults to 512.
 * @returns A Blob object representing the base64 data.
 */
export function base64ToBlob(base64: string, contentType: string = '', sliceSize: number = 512): Blob {
    // Remove metadata part if present (e.g., "data:image/png;base64,")
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

    try {
        const byteCharacters = atob(base64Data);
        const byteArrays: Uint8Array[] = [];

        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);

            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }

            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }

        return new Blob(byteArrays, { type: contentType });
    } catch (error) {
        console.error('Error converting base64 to Blob:', error);
        // Return an empty blob or re-throw, depending on desired error handling
        return new Blob([], { type: contentType }); 
    }
}

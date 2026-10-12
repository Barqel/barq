export interface UploadedFile {
	field: string;
	name: string;
	type: string;
	size: number;
	savedAs?: string;
	path?: string;
	file: File;
}

export interface UploadOptions {
	dest?: string;
	maxFileSize?: number;
	maxFiles?: number;
	accept?: string[];
	generateFilename?: (file: File) => string;
	createDestDir?: boolean;
}

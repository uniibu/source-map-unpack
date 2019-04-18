import * as Progress from 'ascii-progress'

export class ProgressBar extends (Progress as { new(options: any): any; }) { }
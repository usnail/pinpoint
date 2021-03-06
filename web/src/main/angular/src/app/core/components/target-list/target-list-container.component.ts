import { Component, OnInit, OnDestroy, ComponentFactoryResolver, Injector, ViewChild, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';

import { UrlPathId } from 'app/shared/models';
import { Filter } from 'app/core/models/filter';
import {
    UrlRouteManagerService,
    NewUrlStateNotificationService,
    AnalyticsService,
    TRACKED_EVENT_LIST,
    DynamicPopupService,
    MessageQueueService,
    MESSAGE_TO
} from 'app/shared/services';
import { ServerMapData } from 'app/core/components/server-map/class/server-map-data.class';
import { FilterTransactionWizardPopupContainerComponent } from 'app/core/components/filter-transaction-wizard-popup/filter-transaction-wizard-popup-container.component';
import { SearchInputDirective } from 'app/shared/directives/search-input.directive';

@Component({
    selector: 'pp-target-list-container',
    templateUrl: './target-list-container.component.html',
    styleUrls: ['./target-list-container.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class TargetListContainerComponent implements OnInit, OnDestroy {
    @ViewChild(SearchInputDirective, {static: true}) searchInputDirective: SearchInputDirective;

    private unsubscribe = new Subject<void>();

    i18nText: { [key: string]: string } = {};
    query = '';
    target: ISelectedTarget;
    minLength = 2;
    targetList: any[];
    serverMapData: ServerMapData;
    originalTargetList: any[];
    searchUseEnter = false;
    showList = false;

    constructor(
        private injector: Injector,
        private componentFactoryResolver: ComponentFactoryResolver,
        private translateService: TranslateService,
        private analyticsService: AnalyticsService,
        private urlRouteManagerService: UrlRouteManagerService,
        private newUrlStateNotificationService: NewUrlStateNotificationService,
        private dynamicPopupService: DynamicPopupService,
        private messageQueueService: MessageQueueService,
        private cd: ChangeDetectorRef,
    ) {}

    ngOnInit() {
        this.getI18NText();
        this.listenToEmitter();
    }

    ngOnDestroy() {
        this.unsubscribe.next();
        this.unsubscribe.complete();
    }

    private getI18NText() {
        this.translateService.get('COMMON.SEARCH_INPUT').subscribe((txt: string) => {
            this.i18nText.PLACE_HOLDER = txt;
        });
    }

    private listenToEmitter(): void {
        this.messageQueueService.receiveMessage(this.unsubscribe, MESSAGE_TO.SERVER_MAP_DATA_UPDATE).subscribe((data: ServerMapData) => {
            this.serverMapData = data;
        });

        this.messageQueueService.receiveMessage(this.unsubscribe, MESSAGE_TO.SERVER_MAP_TARGET_SELECT).subscribe((target: ISelectedTarget) => {
            this.target = target;
            this.showList = this.hasMultiInput(target);
            if (this.showList) {
                this.gatherTargets();
                this.initSearchInput();
            }

            this.cd.detectChanges();
        });
    }

    private initSearchInput(): void {
        if (this.searchInputDirective) {
            this.searchInputDirective.clear();
        }
    }

    private hasMultiInput(target: ISelectedTarget): boolean {
        return target.isWAS ? false
            : target.isMerged ? true
            : target.isLink ? false
            : this.serverMapData.getLinkListByTo(target.node[0]).length > 1 ? true
            : false;
    }

    private gatherTargets(): void {
        const targetList: any[] = [];

        if (this.target.isNode) {
            this.target.node.forEach((nodeKey: string) => {
                targetList.push([this.serverMapData.getNodeData(nodeKey), '']);
            });
            if (this.target.groupedNode) {
                targetList.forEach((targetData: any[]) => {
                    targetData[0].fromList = this.target.groupedNode.map((key: string) => {
                        return this.serverMapData.getLinkData(key + '~' + targetData[0].key);
                    });
                });
            } else if (this.target.isMerged === false) {
                targetList[0][0].fromList = this.serverMapData.getLinkListByTo(this.target.node[0]);
            }
        } else if (this.target.isLink) {
            this.target.link.forEach((linkKey: string) => {
                targetList.push([this.serverMapData.getLinkData(linkKey), linkKey]);
            });
        }
        this.originalTargetList = this.targetList = targetList;
    }

    onSelectTarget(target: any): void {
        this.analyticsService.trackEvent(TRACKED_EVENT_LIST.CLICK_NODE_IN_GROUPED_VIEW);
        this.messageQueueService.sendMessage({
            to: MESSAGE_TO.SERVER_MAP_TARGET_SELECT_BY_LIST,
            param: target
        });
    }

    onOpenFilter([target]: any): void {
        this.analyticsService.trackEvent(TRACKED_EVENT_LIST.CLICK_FILTER_TRANSACTION);
        const isBothWas = target.sourceInfo.isWas && target.targetInfo.isWas;

        this.urlRouteManagerService.openPage(
            this.urlRouteManagerService.makeFilterMapUrl({
                applicationName: target.filterApplicationName,
                serviceType: target.filterApplicationServiceTypeName,
                periodStr: this.newUrlStateNotificationService.getPathValue(UrlPathId.PERIOD).getValueWithAddedWords(),
                timeStr: this.newUrlStateNotificationService.getPathValue(UrlPathId.END_TIME).getEndTime(),
                filterStr: this.newUrlStateNotificationService.hasValue(UrlPathId.FILTER) ? this.newUrlStateNotificationService.getPathValue(UrlPathId.FILTER) : '',
                hintStr: this.newUrlStateNotificationService.hasValue(UrlPathId.HINT) ? this.newUrlStateNotificationService.getPathValue(UrlPathId.HINT) : '',
                addedFilter: new Filter(
                    target.sourceInfo.applicationName,
                    target.sourceInfo.serviceType,
                    target.targetInfo.applicationName,
                    target.targetInfo.serviceType
                ),
                addedHint: isBothWas ? {[target.targetInfo.applicationName]: target.filterTargetRpcList} : null
            })
        );
    }

    getRequestSum(): number  {
        return this.targetList.reduce((acc: number, target: any) => {
            return acc + target[0].totalCount;
        }, 0);
    }

    onOpenFilterWizard(target: any): void {
        this.analyticsService.trackEvent(TRACKED_EVENT_LIST.OPEN_FILTER_TRANSACTION_WIZARD);
        this.dynamicPopupService.openPopup({
            data: this.serverMapData.getLinkData(target[1]),
            component: FilterTransactionWizardPopupContainerComponent
        }, {
            resolver: this.componentFactoryResolver,
            injector: this.injector
        });
    }

    onCancel(): void {
        this.setFilterQuery('');
    }

    onSearch(query: string): void {
        this.setFilterQuery(query);
    }

    setFilterQuery(query: string): void {
        this.query = query;
        this.targetList = this.filterList();
    }

    private filterList(): any[] {
        if (this.query === '') {
            return this.originalTargetList;
        }
        const filteredList: any = [];
        this.originalTargetList.forEach((aTarget: any) => {
            if (aTarget[0].applicationName.indexOf(this.query) !== -1) {
                filteredList.push(aTarget);
            }
        });

        return filteredList;
    }
}
